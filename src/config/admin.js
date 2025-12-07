/**
 * Single Source of Truth for Admin IDs (Backend)
 */
const ADMIN_IDS = [
    'CR9935850'
];

module.exports = {
    ADMIN_IDS,
    isAdminId: (id) => ADMIN_IDS.includes(id)
};
