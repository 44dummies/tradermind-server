const Sentry = require('@sentry/node');
const logger = require('./Logger');

// Initialize Sentry if DSN is present
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: 1.0,
    });
}

class AlertService {
    async sendAlert(level, message, context = {}) {
        // Log locally
        logger.log(level === 'critical' ? 'error' : level, message, context);

        // Send to Sentry if critical
        if (level === 'critical' || level === 'error') {
            Sentry.captureMessage(message, {
                level: level === 'critical' ? 'fatal' : 'error',
                extra: context
            });
        }

        // Send generic notification (Email/SMS mock)
        if (level === 'critical') {
            await this.sendSMS(message);
            await this.sendEmail(message);
        }
    }

    async sendSMS(msg) {
        if (process.env.SMS_PROVIDER_URL) {
            // Implement SMS logic
            console.log(`[SMS SENT] ${msg}`);
        } else {
            console.log(`[SMS MOCK] ${msg}`);
        }
    }

    async sendEmail(msg) {
        if (process.env.EMAIL_SMTP_HOST) {
            // Implement Email logic
            console.log(`[EMAIL SENT] ${msg}`);
        } else {
            console.log(`[EMAIL MOCK] ${msg}`);
        }
    }
}

module.exports = new AlertService();
