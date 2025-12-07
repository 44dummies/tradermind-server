

const { prisma } = require('./database');

const TOXIC_PATTERNS = [
  
  { pattern: /\b(idiot|stupid|dumb|moron|fool)\b/gi, severity: 'low', score: 10 },
  { pattern: /\b(scam|scammer|fraud|fake)\b/gi, severity: 'medium', score: 25 },
  { pattern: /\b(guaranteed\s+profit|100%\s+win|free\s+money)\b/gi, severity: 'high', score: 50 },
  { pattern: /\b(telegram|whatsapp|signal)\s*(group|channel)?\s*[@:]\s*\S+/gi, severity: 'high', score: 40 },
  { pattern: /(https?:\/\/[^\s]+)/gi, severity: 'medium', score: 15 }, 
  { pattern: /\b(dm\s+me|pm\s+me|contact\s+me)\b/gi, severity: 'medium', score: 20 },
  { pattern: /\b(deposit|invest)\s*(with\s+me|now)\b/gi, severity: 'high', score: 50 }
];

const SPAM_PATTERNS = [
  { pattern: /(.)\1{5,}/gi, severity: 'low', score: 15 }, 
  { pattern: /(.{3,})\1{3,}/gi, severity: 'medium', score: 25 }, 
  { pattern: /[A-Z]{10,}/g, severity: 'low', score: 10 }, 
  { pattern: /\$\d+/gi, severity: 'low', score: 5 } 
];

const FAKE_SIGNAL_PATTERNS = [
  { pattern: /\b(buy|sell)\s+(now|immediately|urgent)\b/gi, severity: 'high', score: 40 },
  { pattern: /\b(guaranteed|sure|100%)\s+(win|profit|money)\b/gi, severity: 'high', score: 60 },
  { pattern: /\b(insider|secret|leaked)\s+(info|information|tip)\b/gi, severity: 'high', score: 55 },
  { pattern: /\b(pump|moon|rocket)\b/gi, severity: 'medium', score: 20 }
];

const RATE_LIMITS = {
  messagesPerMinute: 10,
  messagesPerHour: 100,
  duplicateWindow: 5000, 
  minMessageInterval: 500 
};

const userMessageHistory = new Map();

function analyzeToxicity(message) {
  let totalScore = 0;
  const violations = [];
  
  for (const pattern of TOXIC_PATTERNS) {
    const matches = message.match(pattern.pattern);
    if (matches) {
      totalScore += pattern.score * matches.length;
      violations.push({
        type: 'toxicity',
        severity: pattern.severity,
        matches: matches.slice(0, 3) 
      });
    }
  }
  
  return { score: Math.min(totalScore, 100), violations };
}

function analyzeSpam(message) {
  let totalScore = 0;
  const violations = [];
  
  for (const pattern of SPAM_PATTERNS) {
    const matches = message.match(pattern.pattern);
    if (matches) {
      totalScore += pattern.score * Math.min(matches.length, 5);
      violations.push({
        type: 'spam',
        severity: pattern.severity,
        matches: matches.slice(0, 3)
      });
    }
  }
  
  return { score: Math.min(totalScore, 100), violations };
}

function analyzeFakeSignals(message) {
  let totalScore = 0;
  const violations = [];
  
  for (const pattern of FAKE_SIGNAL_PATTERNS) {
    const matches = message.match(pattern.pattern);
    if (matches) {
      totalScore += pattern.score * matches.length;
      violations.push({
        type: 'fake_signal',
        severity: pattern.severity,
        matches: matches.slice(0, 3)
      });
    }
  }
  
  return { score: Math.min(totalScore, 100), violations };
}

function checkRateLimit(userId) {
  const now = Date.now();
  let history = userMessageHistory.get(userId);
  
  if (!history) {
    history = { messages: [], lastMessage: 0, duplicates: new Map() };
    userMessageHistory.set(userId, history);
  }
  
  
  history.messages = history.messages.filter(t => now - t < 3600000);
  
  const result = { allowed: true, violations: [] };
  
  
  if (now - history.lastMessage < RATE_LIMITS.minMessageInterval) {
    result.allowed = false;
    result.violations.push({ type: 'rate_limit', reason: 'Too fast' });
  }
  
  
  const lastMinute = history.messages.filter(t => now - t < 60000).length;
  if (lastMinute >= RATE_LIMITS.messagesPerMinute) {
    result.allowed = false;
    result.violations.push({ type: 'rate_limit', reason: 'Too many messages per minute' });
  }
  
  
  if (history.messages.length >= RATE_LIMITS.messagesPerHour) {
    result.allowed = false;
    result.violations.push({ type: 'rate_limit', reason: 'Too many messages per hour' });
  }
  
  return result;
}

function checkDuplicate(userId, messageHash) {
  const history = userMessageHistory.get(userId);
  if (!history) return { isDuplicate: false };
  
  const now = Date.now();
  const lastDuplicate = history.duplicates.get(messageHash);
  
  if (lastDuplicate && now - lastDuplicate < RATE_LIMITS.duplicateWindow) {
    return { isDuplicate: true };
  }
  
  return { isDuplicate: false };
}

function recordMessage(userId, messageHash) {
  const now = Date.now();
  let history = userMessageHistory.get(userId);
  
  if (!history) {
    history = { messages: [], lastMessage: 0, duplicates: new Map() };
    userMessageHistory.set(userId, history);
  }
  
  history.messages.push(now);
  history.lastMessage = now;
  history.duplicates.set(messageHash, now);
  
  
  for (const [hash, time] of history.duplicates) {
    if (now - time > RATE_LIMITS.duplicateWindow * 2) {
      history.duplicates.delete(hash);
    }
  }
}

function hashMessage(message) {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

async function moderateMessage(userId, message, chatroomId) {
  const messageHash = hashMessage(message.toLowerCase().trim());
  
  
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return {
      approved: false,
      reason: 'rate_limit',
      message: 'Please slow down. You are sending messages too quickly.',
      violations: rateLimit.violations
    };
  }
  
  
  const duplicate = checkDuplicate(userId, messageHash);
  if (duplicate.isDuplicate) {
    return {
      approved: false,
      reason: 'duplicate',
      message: 'Please avoid sending duplicate messages.',
      violations: [{ type: 'duplicate', severity: 'low' }]
    };
  }
  
  
  const toxicity = analyzeToxicity(message);
  const spam = analyzeSpam(message);
  const fakeSignals = analyzeFakeSignals(message);
  
  const totalScore = toxicity.score + spam.score + fakeSignals.score;
  const allViolations = [...toxicity.violations, ...spam.violations, ...fakeSignals.violations];
  
  
  let approved = true;
  let reason = null;
  let action = 'allow';
  let displayMessage = message;
  
  if (totalScore >= 80) {
    approved = false;
    reason = 'content_violation';
    action = 'block';
  } else if (totalScore >= 50) {
    approved = true;
    action = 'flag';
    
  } else if (totalScore >= 30) {
    approved = true;
    action = 'warn';
    
  }
  
  
  if (approved) {
    recordMessage(userId, messageHash);
  }
  
  
  if (allViolations.length > 0) {
    try {
      await prisma.moderationLog.create({
        data: {
          userId,
          chatroomId,
          content: message.substring(0, 500),
          action,
          reason: allViolations.map(v => v.type).join(', '),
          score: totalScore,
          violations: allViolations
        }
      });
    } catch (err) {
      console.error('Failed to log moderation:', err);
    }
  }
  
  return {
    approved,
    reason,
    action,
    score: totalScore,
    violations: allViolations,
    message: approved ? displayMessage : 'Your message was blocked due to content policy violations.'
  };
}

async function updateUserReputation(userId, action) {
  let reputationChange = 0;
  
  switch (action) {
    case 'block':
      reputationChange = -10;
      break;
    case 'flag':
      reputationChange = -5;
      break;
    case 'warn':
      reputationChange = -2;
      break;
    case 'positive_report':
      reputationChange = 5;
      break;
    case 'helpful_content':
      reputationChange = 2;
      break;
  }
  
  if (reputationChange !== 0) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        reputationScore: { increment: reputationChange },
        violationCount: action === 'block' ? { increment: 1 } : undefined
      }
    });
  }
}

async function checkUserStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { reputationScore: true, violationCount: true, muteUntil: true, isBanned: true }
  });
  
  if (!user) return { canPost: false, reason: 'User not found' };
  if (user.isBanned) return { canPost: false, reason: 'Account suspended' };
  if (user.muteUntil && new Date(user.muteUntil) > new Date()) {
    return { canPost: false, reason: 'Temporarily muted', until: user.muteUntil };
  }
  
  
  if (user.violationCount >= 10) {
    const muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); 
    await prisma.user.update({
      where: { id: userId },
      data: { muteUntil }
    });
    return { canPost: false, reason: 'Auto-muted due to violations', until: muteUntil };
  }
  
  return { canPost: true };
}

async function reportMessage(messageId, reporterId, reason) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { user: true }
  });
  
  if (!message) return { success: false, error: 'Message not found' };
  
  
  await prisma.moderationLog.create({
    data: {
      userId: message.userId,
      chatroomId: message.chatroomId,
      content: message.content,
      action: 'reported',
      reason: `Reported by ${reporterId}: ${reason}`,
      reportedBy: reporterId
    }
  });
  
  
  await prisma.user.update({
    where: { id: message.userId },
    data: { violationCount: { increment: 1 } }
  });
  
  return { success: true };
}

async function getChatroomModerationStats(chatroomId) {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const stats = await prisma.moderationLog.groupBy({
    by: ['action'],
    where: {
      chatroomId,
      createdAt: { gte: last24h }
    },
    _count: { action: true }
  });
  
  return stats.reduce((acc, s) => {
    acc[s.action] = s._count.action;
    return acc;
  }, {});
}

module.exports = {
  moderateMessage,
  updateUserReputation,
  checkUserStatus,
  reportMessage,
  getChatroomModerationStats,
  analyzeToxicity,
  analyzeSpam,
  analyzeFakeSignals
};
