/**
 * Database Utilities
 * Shared helpers for robust database interactions
 */

/**
 * Retry a database operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} baseDelay - Initial delay in ms (default: 1000)
 * @returns {Promise<any>} - Result of the operation
 */
async function retryOperation(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            // Determine if error is retryable (e.g., connection lost, timeout)
            // For now, we assume all DB errors are worth a quick retry unless it's a constraint violation
            const isConstraintError = error.code === '23505'; // Unique violation
            if (isConstraintError) {
                throw error; // Don't retry logic errors
            }

            console.warn(`[dbUtils] Operation failed (Attempt ${attempt + 1}/${maxRetries}): ${error.message}`);

            if (attempt < maxRetries - 1) {
                // Exponential backoff with jitter
                const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

module.exports = {
    retryOperation
};
