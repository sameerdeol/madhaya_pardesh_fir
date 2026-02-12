import mysql from 'mysql2/promise';

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'madhayapardesh_fir_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

export async function checkConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

export async function resetProcessingRequests() {
    try {
        const [result] = await pool.execute(
            "UPDATE requests SET status='stopped' WHERE status='processing'"
        );
        if (result.changedRows > 0) {
            console.log(`🛑 Reset ${result.changedRows} pending requests to 'stopped' state.`);
        }
    } catch (error) {
        console.error('❌ Failed to reset processing requests:', error.message);
    }
}

export default pool;
