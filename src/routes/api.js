import express from 'express';
import * as authController from '../controllers/authController.js';
import * as firController from '../controllers/firController.js';
import * as fileController from '../controllers/fileController.js';

const router = express.Router();

// Auth Routes
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/resend-otp', authController.resendOtp);

// FIR Routes
router.get('/districts', firController.getDistricts);
router.post('/get-stations', firController.getStations);
router.post('/search-firs', firController.searchFirs);
router.post('/download-fir', firController.downloadSingleFir);


export default router;
