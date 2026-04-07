const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB,
    password: process.env.PG_PASSWORD,
    port: Number(process.env.PG_PORT),
});

pool.on('connect', () => {
    console.log('Postgres connected');
});


// Seed endpoint - creates 20 sample products
app.post("/seed", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const products = [
            { name: 'Keyboard', stock: 5, price: 49.99 },
            { name: 'Mouse', stock: 10, price: 29.99 },
            { name: 'Monitor', stock: 2, price: 299.99 },
            { name: 'Laptop', stock: 8, price: 999.99 },
            { name: 'Headphones', stock: 15, price: 79.99 },
            { name: 'Webcam', stock: 12, price: 89.99 },
            { name: 'USB Cable', stock: 50, price: 9.99 },
            { name: 'HDMI Cable', stock: 30, price: 14.99 },
            { name: 'Desk Lamp', stock: 7, price: 39.99 },
            { name: 'Chair', stock: 3, price: 199.99 },
            { name: 'Desk', stock: 4, price: 349.99 },
            { name: 'Mousepad', stock: 25, price: 19.99 },
            { name: 'Speakers', stock: 6, price: 129.99 },
            { name: 'Microphone', stock: 9, price: 149.99 },
            { name: 'Docking Station', stock: 5, price: 249.99 },
            { name: 'External SSD', stock: 11, price: 119.99 },
            { name: 'USB Hub', stock: 20, price: 34.99 },
            { name: 'Laptop Stand', stock: 14, price: 44.99 },
            { name: 'Cable Organizer', stock: 40, price: 12.99 },
            { name: 'Monitor Arm', stock: 8, price: 89.99 }
        ];

        for (const product of products) {
            await client.query(
                'INSERT INTO products (name, stock, price) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
                [product.name, product.stock, product.price]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ message: '20 products seeded successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Failed to seed products' });
    } finally {
        client.release();
    }
});

app.get("/products", async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, stock, price FROM products ORDER BY id'
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});


// Place order with atomic stock reservation using SELECT FOR UPDATE
app.post("/orders", async (req, res) => {
    const client = await pool.connect();
    try {
        const { customer_email, items } = req.body;
        
        if (!customer_email || !customer_email.trim()) {
            return res.status(400).json({ error: 'customer_email is required' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array is required' });
        }

        await client.query('BEGIN');

        let status = 'PLACED';
        const productUpdates = [];

        // Lock and validate all products first
        for (const item of items) {
            if (!item.product_id || !item.qty || item.qty <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Invalid item format' });
            }

            // SELECT FOR UPDATE locks the row for this transaction
            const productResult = await client.query(
                'SELECT id, stock, price FROM products WHERE id = $1 FOR UPDATE',
                [item.product_id]
            );

            if (productResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: `Product ${item.product_id} not found` });
            }

            const product = productResult.rows[0];

            // Check if stock is sufficient
            if (product.stock < item.qty) {
                status = 'REJECTED';
                break;
            }

            productUpdates.push({
                product_id: item.product_id,
                qty: item.qty,
                unit_price: product.price,
                new_stock: product.stock - item.qty
            });
        }

        // Create order
        const orderResult = await client.query(
            'INSERT INTO orders (customer_email, status) VALUES ($1, $2) RETURNING id, status, created_at',
            [customer_email.trim(), status]
        );

        const order = orderResult.rows[0];

        // If order is PLACED, update stock and insert order items
        if (status === 'PLACED') {
            for (const update of productUpdates) {
                // Update stock atomically
                await client.query(
                    'UPDATE products SET stock = $1 WHERE id = $2',
                    [update.new_stock, update.product_id]
                );

                // Insert order item
                await client.query(
                    'INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES ($1, $2, $3, $4)',
                    [order.id, update.product_id, update.qty, update.unit_price]
                );
            }
        } else {
            // For REJECTED orders, still insert order items with original prices
            for (const item of items) {
                const productResult = await client.query(
                    'SELECT price FROM products WHERE id = $1',
                    [item.product_id]
                );
                
                if (productResult.rows.length > 0) {
                    await client.query(
                        'INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES ($1, $2, $3, $4)',
                        [order.id, item.product_id, item.qty, productResult.rows[0].price]
                    );
                }
            }
        }

        await client.query('COMMIT');

        res.status(status === 'PLACED' ? 201 : 409).json({
            order_id: order.id,
            status: order.status,
            created_at: order.created_at
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Failed to place order' });
    } finally {
        client.release();
    }
});

// Orders report with JOIN and aggregation
app.get("/reports/orders", async (req, res) => {
    try {
        const { from, to } = req.query;

        let query = `
            SELECT 
                o.id as order_id,
                o.customer_email,
                o.status,
                COALESCE(SUM(oi.qty * oi.unit_price), 0) as total_amount,
                COALESCE(SUM(oi.qty), 0) as item_count,
                o.created_at
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
        `;

        const params = [];
        const conditions = [];

        if (from) {
            params.push(from);
            conditions.push(`o.created_at >= $${params.length}::date`);
        }

        if (to) {
            params.push(to);
            conditions.push(`o.created_at <= $${params.length}::date + INTERVAL '1 day'`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += `
            GROUP BY o.id, o.customer_email, o.status, o.created_at
            ORDER BY o.created_at DESC
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});


// Orders report with JOIN and aggregation
app.get("/reports/orders", async (req, res) => {
    try {
        const { from, to } = req.query;

        let query = `
            SELECT 
                o.id as order_id,
                o.customer_email,
                o.status,
                COALESCE(SUM(oi.qty * oi.unit_price), 0) as total_amount,
                COALESCE(SUM(oi.qty), 0) as item_count,
                o.created_at
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
        `;

        const params = [];
        const conditions = [];

        if (from) {
            params.push(from);
            conditions.push(`o.created_at >= $${params.length}::date`);
        }

        if (to) {
            params.push(to);
            conditions.push(`o.created_at <= $${params.length}::date + INTERVAL '1 day'`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += `
            GROUP BY o.id, o.customer_email, o.status, o.created_at
            ORDER BY o.created_at DESC
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Part C: Top 3 products by sold quantity in last 7 days
app.get("/reports/top-products", async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id as product_id,
                p.name,
                COALESCE(SUM(oi.qty), 0) as sold_qty
            FROM products p
            LEFT JOIN order_items oi ON p.id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.id
            WHERE o.status = 'PLACED' 
              AND o.created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY p.id, p.name
            ORDER BY sold_qty DESC
            LIMIT 3
        `;

        const result = await pool.query(query);
        res.json(result.rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate top products report' });
    }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});