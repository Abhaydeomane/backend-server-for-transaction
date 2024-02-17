const express = require('express');
const pool = require('./mysql_conn');
const axios = require('axios');


const app = express();
const PORT = process.env.PORT || 5000;
app.use(express.json());


// initialize database with  data
app.get('/initialize', async (req, res) => {
    try {
        const response = await axios.get('https://s3.amazonaws.com/roxiler.com/product_transaction.json');
        const transactions = response.data;

        const connection = await pool.getConnection();

        // Loop through each transaction and insert it into the database
        for (const transaction of transactions) {
            await connection.query('INSERT INTO products SET ?', transaction);
        }

        connection.release();

        res.status(200).json({ message: 'Database initialized with seed data' });
    } catch (error) {
        console.error('Error initializing  database :', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

//transactios per months ,search , pagination
app.get('/transactions', async (req, res) => {
    try {
      // Extract query parameters
      const { month, search, page = 1, perPage = 10 } = req.query;
      const offset = (page - 1) * perPage;
  
      // Construct base SQL query
      let sql = 'SELECT * FROM products WHERE MONTH(dateOfSale) = ?';
      let params = [month];
  
      // Add search criteria if provided
      if (search) {
        sql += ' AND (title LIKE ? OR description LIKE ? OR price LIKE ?)';
        params = [...params, `%${search}%`, `%${search}%`, `%${search}%`];
      }
  
      // Add pagination
      sql += ' LIMIT ?, ?';
      params = [...params, offset, perPage];
  
      // Execute the query
      const connection = await pool.getConnection();
      const [results] = await connection.execute(sql, params);
      connection.release();
  
      res.json({ transactions: results });
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

//  for statistics .
app.get('/statistics', async (req, res) => {
    try {
        const { month } = req.query;

        // Fetch total sale amount
        const [totalSaleAmountRows] = await pool.execute(
            'SELECT SUM(price) AS totalSaleAmount FROM products WHERE MONTH(dateOfSale) = ? AND sold = true',
            [month]
        );
        const totalSaleAmount = totalSaleAmountRows[0].totalSaleAmount || 0;

        // Fetch total number of sold items
        const [totalSoldItemsRows] = await pool.execute(
            'SELECT COUNT(*) AS totalSoldItems FROM products WHERE MONTH(dateOfSale) = ? AND sold = true',
            [month]
        );
        const totalSoldItems = totalSoldItemsRows[0].totalSoldItems || 0;

        // Fetch total number of unsold items
        const [totalUnsoldItemsRows] = await pool.execute(
            'SELECT COUNT(*) AS totalUnsoldItems FROM products WHERE MONTH(dateOfSale) = ? AND sold = false',
            [month]
        );
        const totalUnsoldItems = totalUnsoldItemsRows[0].totalUnsoldItems || 0;

        res.json({
            totalSaleAmount,
            totalSoldItems,
            totalUnsoldItems
        });
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

//for bar n chart
app.get('/bar-chart', async (req, res) => {
    try {
        const { month } = req.query;

        // Fetch price ranges and count of items falling into each range
        const [priceRanges] = await pool.execute(
            `SELECT 
                SUM(CASE WHEN price BETWEEN 0 AND 100 THEN 1 ELSE 0 END) AS range_0_100,
                SUM(CASE WHEN price BETWEEN 101 AND 200 THEN 1 ELSE 0 END) AS range_101_200,
                SUM(CASE WHEN price BETWEEN 201 AND 300 THEN 1 ELSE 0 END) AS range_201_300,
                SUM(CASE WHEN price BETWEEN 301 AND 400 THEN 1 ELSE 0 END) AS range_301_400,
                SUM(CASE WHEN price BETWEEN 401 AND 500 THEN 1 ELSE 0 END) AS range_401_500,
                SUM(CASE WHEN price BETWEEN 501 AND 600 THEN 1 ELSE 0 END) AS range_501_600,
                SUM(CASE WHEN price BETWEEN 601 AND 700 THEN 1 ELSE 0 END) AS range_601_700,
                SUM(CASE WHEN price BETWEEN 701 AND 800 THEN 1 ELSE 0 END) AS range_701_800,
                SUM(CASE WHEN price BETWEEN 801 AND 900 THEN 1 ELSE 0 END) AS range_801_900,
                SUM(CASE WHEN price >= 901 THEN 1 ELSE 0 END) AS range_901_above
            FROM products
            WHERE MONTH(dateOfSale) = ?`,
            [month]
        );

        // Return the price ranges and count of items in each range as JSON response
        res.json({
            priceRanges: {
                '0 - 100': priceRanges[0].range_0_100,
                '101 - 200': priceRanges[0].range_101_200,
                '201 - 300': priceRanges[0].range_201_300,
                '301 - 400': priceRanges[0].range_301_400,
                '401 - 500': priceRanges[0].range_401_500,
                '501 - 600': priceRanges[0].range_501_600,
                '601 - 700': priceRanges[0].range_601_700,
                '701 - 800': priceRanges[0].range_701_800,
                '801 - 900': priceRanges[0].range_801_900,
                '901 - above': priceRanges[0].range_901_above
            }
        });
    } catch (error) {
        console.error('Error fetching bar chart data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/pie-chart', async (req, res) => {
    try {
        const { month } = req.query;

        // Fetch unique categories and count of items in each category
        const [categories] = await pool.execute(
            `SELECT category, COUNT(*) AS itemCount
            FROM products
            WHERE MONTH(dateOfSale) = ?
            GROUP BY category`,
            [month]
        );

        res.json({ categories });
    } catch (error) {
        console.error('Error fetching pie chart data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/combined', async (req, res) => {
    try {
        const { month } = req.query;

        const response1 = await axios.get(`http://localhost:5000/statistics?month=${month}`);
        const response2 = await axios.get(`http://localhost:5000/pie-chart?month=${month}`);
        const response3 = await axios.get(`http://localhost:5000/bar-chart?month=${month}`);

        // Combine responses into a single JSON object
        const combinedData = {
            statistics: response1.data,
            pie_chart: response2.data,
            bar_chart: response3.data
        };

        res.json(combinedData);
    } catch (error) {
        console.error('Error fetching combined data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/',async(req,res)=>{
  res.status(200).json("server is running");
})

app.listen(PORT, () => 
console.log(`Listening at Port ${PORT}`))