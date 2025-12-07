

const express = require('express');
const router = express.Router();
const MentorService = require('../services/mentor');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.post('/set/:mentorId', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { chatId } = req.body;
    const result = await MentorService.setMentor(currentUser.id, req.params.mentorId, chatId);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.params.mentorId}`).emit('mentor:assigned', {
        mentee: currentUser,
        chatId
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Set mentor error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/remove/:mentorId', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await MentorService.removeMentor(currentUser.id, req.params.mentorId);
    res.json(result);
  } catch (error) {
    console.error('Remove mentor error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/mentees', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const mentees = await MentorService.getMentees(currentUser.id);
    res.json(mentees);
  } catch (error) {
    console.error('Get mentees error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/my-mentor', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const mentor = await MentorService.getMentor(currentUser.id);
    res.json(mentor);
  } catch (error) {
    console.error('Get mentor error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/feedback/:menteeId', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { chatId, ...feedbackData } = req.body;
    const feedback = await MentorService.submitFeedback(
      currentUser.id, 
      req.params.menteeId, 
      chatId, 
      feedbackData
    );
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.params.menteeId}`).emit('mentor:feedback', {
        mentor: currentUser,
        feedback
      });
    }
    
    res.json(feedback);
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/feedback/history', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { mentorId } = req.query;
    const history = await MentorService.getFeedbackHistory(currentUser.id, mentorId);
    res.json(history);
  } catch (error) {
    console.error('Get feedback history error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/:menteeId', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    
    const mentees = await MentorService.getMentees(currentUser.id);
    const isMentor = mentees.some(m => m.mentee?.id === req.params.menteeId);
    
    if (!isMentor) {
      return res.status(403).json({ error: 'Not authorized - not a mentor for this user' });
    }
    
    const { weeks = 4 } = req.query;
    const analytics = await MentorService.getMenteeAnalytics(req.params.menteeId, parseInt(weeks));
    res.json(analytics);
  } catch (error) {
    console.error('Get mentee analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
