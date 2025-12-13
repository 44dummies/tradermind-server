/**
 * Token Encryption Utility
 * AES-256-GCM encryption for Deriv API tokens
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a token using AES-256-GCM
 * @param {string} plaintext - The token to encrypt
 * @returns {string} - Encrypted token in format "iv:authTag:encryptedData"
 */
function encryptToken(plaintext) {
    if (!plaintext) {
        throw new Error('Token is required for encryption');
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a token encrypted with encryptToken
 * @param {string} encryptedToken - The encrypted token string
 * @returns {string} - Decrypted plaintext token
 */
function decryptToken(encryptedToken) {
    if (!encryptedToken) {
        throw new Error('Encrypted token is required for decryption');
    }

    // If token doesn't look encrypted (no colons), return as-is (legacy support)
    if (!encryptedToken.includes(':')) {
        console.warn('[Encryption] Token appears unencrypted, returning as-is');
        return encryptedToken;
    }

    const key = getEncryptionKey();

    const parts = encryptedToken.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted token format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, null, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Get encryption key from environment
 */
function getEncryptionKey() {
    const keyHex = process.env.ENCRYPTION_KEY;

    if (!keyHex) {
        throw new Error('ENCRYPTION_KEY environment variable is required for token encryption');
    }

    return Buffer.from(keyHex, 'hex');
}

/**
 * Check if a token is encrypted
 */
function isEncrypted(token) {
    if (!token) return false;
    const parts = token.split(':');
    return parts.length === 3 && parts[0].length === 32; // 16 bytes IV = 32 hex chars
}

/**
 * Generate a new encryption key (run once for setup)
 * Usage: node -e "console.log(require('./encryption').generateKey())"
 */
function generateKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    encryptToken,
    decryptToken,
    isEncrypted,
    generateKey
};
