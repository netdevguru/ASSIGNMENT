CREATE TABLE IF NOT EXISTS products(
	id SERIAL PRIMARY KEY,
	name VARCHAR(255) UNIQUE NOT NULL,
	stock INTEGER NOT NULL CHECK (stock >= 0),
	price NUMERIC(10, 2) NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders(
	id SERIAL PRIMARY KEY,
	customer_email VARCHAR(255) NOT NULL,
	status VARCHAR(20) NOT NULL CHECK (status IN ('PLACED', 'REJECTED')),
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items(
	id SERIAL PRIMARY KEY,
	order_id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	qty INTEGER NOT NULL CHECK (qty > 0),
	unit_price NUMERIC(10, 2) NOT NULL,
	CONSTRAINT fk_orderid FOREIGN KEY (order_id) REFERENCES orders(id),
	CONSTRAINT fk_productid FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- Top 3 products by sold quantity in last 7 days (PLACED only)
-- Query for Part C:
-- SELECT 
--     p.id as product_id,
--     p.name,
--     COALESCE(SUM(oi.qty), 0) as sold_qty
-- FROM products p
-- LEFT JOIN order_items oi ON p.id = oi.product_id
-- LEFT JOIN orders o ON oi.order_id = o.id
-- WHERE o.status = 'PLACED' 
--   AND o.created_at >= CURRENT_DATE - INTERVAL '7 days'
-- GROUP BY p.id, p.name
-- ORDER BY sold_qty DESC
-- LIMIT 3;
