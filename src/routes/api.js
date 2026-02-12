import express from 'express';
import * as authController from '../controllers/authController.js';
import * as firController from '../controllers/firController.js';
import * as fileController from '../controllers/fileController.js';

const router = express.Router();

// Auth Routes
router.get('/status', authController.checkStatus);
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/resend-otp', authController.resendOtp);

// FIR Routes
router.get('/districts', firController.getDistricts);
router.post('/get-stations', firController.getStations);
router.post('/search-firs', firController.searchFirs);
router.post('/download-fir', firController.downloadSingleFir);

// Request Management
router.get('/requests', firController.getRequests);
router.post('/stop-request', firController.stopRequest);
router.post('/resume-request', firController.resumeRequest);


export default router;
