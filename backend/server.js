const express = require('express');
const cors = require('cors');
const pg = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({
    extended: true,
}))

const client = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB,
    password: process.env.PG_PASSWORD,
    port: Number(process.env.PG_PORT),
});

client.connect((err) => {
    if(err) console.log(err);
    console.log('Postgres connnected');
});

app.get("/products", async (req, res) => {
    try {
        const limit = req.params.limit || 200;

        const result = await client.query(`SELECT id, name, stock, price, created_at FROM products LIMIT ${limit}`);
        return res.json(result.rows)
    } catch (error) {
        console.log(error);
        await client.end();
    }
    res.json("Products");
});

app.post("/orders", async (req, res) => {
    try {
        let {customer_email, items} = req.body;
        
        if(!customer_email || !customer_email.trim()){
            return res.status(400).json("customer_email required");
        }

        customer_email = customer_email.trim();
        const created_at = new Date().toISOString().slice(0, 10);
        let status = "PLACED";

        // GET PRODUCT ID AND ITS QTY
        for (let index = 0; index < items.length; index++) {
            let product_id_res = await client.query('SELECT id, stock FROM products WHERE id = ($1)', [items[index].product_id]);
            console.log(product_id_res.rows[0].stock);

            stock_available = product_id_res.rows[0].stock;
            status = stock_available >= items[index].qty ? "PLACED": "REJECTED";
            
            // Update product stock
            let updated_stock = stock_available - items[index].qty;
            console.log(`UPDATE products SET stock = ${updated_stock} WHERE id = ${items[index].product_id}`);

            await client.query('UPDATE products SET stock = $1 WHERE id = $2', [updated_stock, items[index].product_id]);

            if (status == "REJECTED") break;
        }
        
        const results = await client.query(
            'INSERT INTO orders (customer_email, status, created_at) VALUES ($1, $2, $3) RETURNING *',
            [customer_email, status, created_at]
        );
        
        return res.status(201).send(`Order ID: ${results.rows[0].id}`)
    } catch (error) {
        console.log(error);
    }
})

const PORT = process.env.PORT;
app.listen(PORT, (err) => {
    if(err) console.log(err);
    console.log(`Server connected ${PORT}`);
});