/**
 * Chatroom Auto-Assignment Engine
 * Matches users to chatrooms based on their trading data
 */

const { prisma } = require('./database');

// Default chatroom definitions
const DEFAULT_CHATROOMS = [
  // Performance-based rooms
  { name: 'Pro Traders Room', type: 'personal', category: 'performance', level: 3, icon: '👑', 
    rules: { minWinRate: 55, minTrades: 50 } },
  { name: 'Improvement Squad', type: 'personal', category: 'performance', level: 1, icon: '📈',
    rules: { maxWinRate: 50 } },
  { name: 'Recovery Motivation', type: 'personal', category: 'performance', level: 1, icon: '💪',
    rules: { hasLossStreak: true } },
  { name: 'Winning Streak Club', type: 'personal', category: 'performance', level: 2, icon: '🔥',
    rules: { hasWinStreak: true } },
  
  // Emotional profile rooms
  { name: 'FOMO Rehab', type: 'personal', category: 'behavior', level: 1, icon: '😰',
    rules: { minFomoScore: 60 } },
  { name: 'Discipline Dojo', type: 'personal', category: 'behavior', level: 2, icon: '🎯',
    rules: { minRevengeScore: 50 } },
  { name: 'Slow & Steady Room', type: 'personal', category: 'behavior', level: 1, icon: '🐢',
    rules: { minOvertradingScore: 60 } },
  { name: 'Emotional Control Hub', type: 'personal', category: 'behavior', level: 2, icon: '🧘',
    rules: { maxEmotionalScore: 40 } },
  
  // Contract type rooms
  { name: 'Multipliers Lab', type: 'personal', category: 'strategy', level: 2, icon: '📈',
    rules: { preferredContract: 'multipliers' } },
  { name: 'Binary Lounge', type: 'personal', category: 'strategy', level: 1, icon: '⬆️',
    rules: { preferredContract: 'rise_fall' } },
  { name: 'Volatility Gang', type: 'personal', category: 'strategy', level: 2, icon: '📊',
    rules: { preferredContract: 'volatility' } },
  { name: 'Digit Masters', type: 'personal', category: 'strategy', level: 2, icon: '🔢',
    rules: { preferredContract: 'digits' } },
  
  // Risk profile rooms
  { name: 'High Risk Circle', type: 'personal', category: 'strategy', level: 3, icon: '🎲',
    rules: { riskLevel: 'high' } },
  { name: 'Smart Risk Traders', type: 'personal', category: 'strategy', level: 2, icon: '🧠',
    rules: { riskLevel: 'moderate' } },
  { name: 'Conservative Traders', type: 'personal', category: 'strategy', level: 1, icon: '🛡️',
    rules: { riskLevel: 'low' } },
  
  // Trading style rooms
  { name: 'Scalpers Den', type: 'personal', category: 'strategy', level: 2, icon: '⚡',
    rules: { tradingStyle: 'scalper' } },
  { name: 'Swing Traders Hub', type: 'personal', category: 'strategy', level: 2, icon: '🌊',
    rules: { tradingStyle: 'swing' } },
  { name: 'Day Traders Lounge', type: 'personal', category: 'strategy', level: 2, icon: '☀️',
    rules: { tradingStyle: 'day' } },
  
  // Public rooms (everyone can join)
  { name: 'Beginners Lounge', type: 'public', category: 'general', level: 1, icon: '🌱',
    description: 'Welcome new traders! Ask questions and learn together.' },
  { name: 'Strategy Builders', type: 'public', category: 'strategy', level: 2, icon: '�',
    description: 'Discuss and build trading strategies together.' },
  { name: 'Daily Trades Discussion', type: 'public', category: 'general', level: 1, icon: '📅',
    description: 'Share and discuss your daily trades.' },
  { name: 'Market Updates', type: 'public', category: 'general', level: 1, icon: '�',
    description: 'Real-time market news and updates.' },
  { name: 'General Discussion', type: 'public', category: 'general', level: 1, icon: '💬',
    description: 'Chat about anything trading-related.' },
  
  // AI-enhanced rooms
  { name: 'AI Trading Insights', type: 'ai', category: 'strategy', level: 2, icon: '🤖',
    description: 'Get AI-powered market analysis and insights.' },
  { name: 'AI Emotional Coach', type: 'ai', category: 'behavior', level: 1, icon: '🧠',
    description: 'AI-driven emotional support and trading psychology.' },
  { name: 'AI Market Summary', type: 'ai', category: 'general', level: 1, icon: '📊',
    description: 'Daily AI-generated market summaries.' }
];

/**
 * Initialize default chatrooms in the database
 */
async function initializeDefaultChatrooms() {
  // Check if chatrooms already exist
  const existingCount = await prisma.chatroom.count({});
  if (existingCount > 0) {
    console.log(`✅ ${existingCount} chatrooms already exist in database`);
    return;
  }

  // Create basic default chatrooms
  const basicRooms = [
    { id: 'room-beginners', name: 'Beginners Lounge', description: 'Welcome! A friendly space for new traders', type: 'level_based', traderLevel: 'BEGINNER' },
    { id: 'room-intermediate', name: 'Intermediate Traders', description: 'Level up your trading game', type: 'level_based', traderLevel: 'INTERMEDIATE' },
    { id: 'room-advanced', name: 'Advanced Strategies', description: 'Deep dive into advanced techniques', type: 'level_based', traderLevel: 'ADVANCED' },
    { id: 'room-experts', name: 'Expert Circle', description: 'Elite traders discussion', type: 'level_based', traderLevel: 'EXPERT' },
    { id: 'room-general', name: 'General Discussion', description: 'Open chat for all traders', type: 'general' }
  ];

  for (const room of basicRooms) {
    try {
      await prisma.chatroom.upsert({
        where: { id: room.id },
        update: {},
        create: room
      });
    } catch (err) {
      console.error(`Failed to create room ${room.id}:`, err.message);
    }
  }
  console.log('✅ Default chatrooms initialized');
}

/**
 * Calculate fit score for a user and chatroom
 * @returns {number} Score from 0-100
 */
function calculateFitScore(user, chatroom) {
  const rules = chatroom.autoAssignmentRules;
  if (!rules) return chatroom.type === 'public' ? 100 : 0;
  
  let score = 0;
  let totalWeight = 0;
  
  // Win rate matching (weight: 25)
  if (rules.minWinRate !== undefined) {
    totalWeight += 25;
    if (user.winRate >= rules.minWinRate) score += 25;
    else score += Math.max(0, 25 * (user.winRate / rules.minWinRate));
  }
  if (rules.maxWinRate !== undefined) {
    totalWeight += 25;
    if (user.winRate <= rules.maxWinRate) score += 25;
    else score += Math.max(0, 25 * (rules.maxWinRate / user.winRate));
  }
  
  // Emotional scores matching (weight: 20 each)
  if (rules.minFomoScore !== undefined) {
    totalWeight += 20;
    if (user.fomoScore >= rules.minFomoScore) score += 20;
    else score += Math.max(0, 20 * (user.fomoScore / rules.minFomoScore));
  }
  if (rules.minRevengeScore !== undefined) {
    totalWeight += 20;
    if (user.revengeScore >= rules.minRevengeScore) score += 20;
    else score += Math.max(0, 20 * (user.revengeScore / rules.minRevengeScore));
  }
  if (rules.minOvertradingScore !== undefined) {
    totalWeight += 20;
    if (user.overtradingScore >= rules.minOvertradingScore) score += 20;
    else score += Math.max(0, 20 * (user.overtradingScore / rules.minOvertradingScore));
  }
  if (rules.maxEmotionalScore !== undefined) {
    totalWeight += 20;
    if (user.emotionalScore <= rules.maxEmotionalScore) score += 20;
    else score += Math.max(0, 20 * (rules.maxEmotionalScore / user.emotionalScore));
  }
  
  // Contract type preference (weight: 30)
  if (rules.preferredContract !== undefined) {
    totalWeight += 30;
    if (user.preferredContractType === rules.preferredContract) score += 30;
    else if (user.preferredContractType === 'mixed') score += 15;
  }
  
  // Risk level (weight: 25)
  if (rules.riskLevel !== undefined) {
    totalWeight += 25;
    if (user.riskLevel === rules.riskLevel) score += 25;
    else if (
      (rules.riskLevel === 'moderate' && (user.riskLevel === 'low' || user.riskLevel === 'high')) ||
      (user.riskLevel === 'moderate')
    ) score += 12;
  }
  
  // Trading style (weight: 25)
  if (rules.tradingStyle !== undefined) {
    totalWeight += 25;
    if (user.tradingStyle === rules.tradingStyle) score += 25;
    else if (user.tradingStyle === 'unknown') score += 10;
  }
  
  // Minimum trades requirement
  if (rules.minTrades !== undefined && user.totalTrades < rules.minTrades) {
    score = score * 0.5; // Penalize if not enough trades
  }
  
  // Normalize score to 0-100
  return totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;
}

/**
 * Get recommended chatrooms for a user
 */
async function getRecommendedChatrooms(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];
  
  const chatrooms = await prisma.chatroom.findMany({
    where: { isActive: true }
  });
  
  const recommendations = chatrooms
    .map(room => ({
      ...room,
      fitScore: calculateFitScore(user, room)
    }))
    .filter(room => room.fitScore > 0 || room.type === 'public')
    .sort((a, b) => b.fitScore - a.fitScore);
  
  return recommendations;
}

/**
 * Auto-assign user to matching chatrooms
 * Only assigns if fitScore > 70
 */
async function autoAssignUserToChatrooms(userId) {
  const recommendations = await getRecommendedChatrooms(userId);
  const assigned = [];
  
  for (const room of recommendations) {
    // Auto-assign if:
    // 1. Public room (everyone gets access)
    // 2. AI room (everyone gets access)
    // 3. Personal room with fitScore > 70
    const shouldAssign = 
      room.type === 'public' || 
      room.type === 'ai' || 
      (room.type === 'personal' && room.fitScore >= 70);
    
    if (shouldAssign) {
      try {
        await prisma.userChatroom.upsert({
          where: {
            userId_chatroomId: { userId, chatroomId: room.id }
          },
          update: { fitScore: room.fitScore, isActive: true },
          create: {
            userId,
            chatroomId: room.id,
            fitScore: room.fitScore
          }
        });
        assigned.push({ roomId: room.id, name: room.name, fitScore: room.fitScore });
      } catch (err) {
        console.error(`Failed to assign user ${userId} to room ${room.id}:`, err);
      }
    }
  }
  
  return assigned;
}

/**
 * Update user's trading profile and re-assign chatrooms
 */
async function updateUserProfileAndReassign(userId, profileData) {
  // Update user profile
  await prisma.user.update({
    where: { id: userId },
    data: {
      winRate: profileData.winRate,
      totalTrades: profileData.totalTrades,
      totalProfit: profileData.totalProfit,
      emotionalScore: profileData.emotionalScore,
      fomoScore: profileData.fomoScore,
      revengeScore: profileData.revengeScore,
      overtradingScore: profileData.overtradingScore,
      disciplineScore: profileData.disciplineScore,
      riskLevel: profileData.riskLevel,
      tradingStyle: profileData.tradingStyle,
      preferredContractType: profileData.preferredContractType
    }
  });
  
  // Re-assign to chatrooms
  return autoAssignUserToChatrooms(userId);
}

/**
 * Get user's assigned chatrooms
 */
async function getUserChatrooms(userId) {
  const userChatrooms = await prisma.userChatroom.findMany({
    where: { userId, isActive: true },
    include: {
      chatroom: true
    },
    orderBy: { fitScore: 'desc' }
  });
  
  return userChatrooms.map(uc => ({
    ...uc.chatroom,
    fitScore: uc.fitScore,
    joinedAt: uc.joinedAt,
    isMuted: uc.isMuted,
    canPost: uc.canPost
  }));
}

module.exports = {
  initializeDefaultChatrooms,
  calculateFitScore,
  getRecommendedChatrooms,
  autoAssignUserToChatrooms,
  updateUserProfileAndReassign,
  getUserChatrooms,
  DEFAULT_CHATROOMS
};
