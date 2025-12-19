

const { supabase } = require('../db/supabase');

const db = {

  user: {
    async findUnique({ where, include }) {
      let query = supabase.from('user_profiles').select('*');
      if (where.id) query = query.eq('id', where.id);
      if (where.derivId) query = query.eq('deriv_id', where.derivId);
      if (where.email) query = query.eq('email', where.email);
      const { data, error } = await query.single();
      if (error) return null;

      if (data) {
        data.derivId = data.deriv_id;
        data.isOnline = data.is_online;
        data.lastSeen = data.last_seen;
        data.createdAt = data.created_at;
        data.updatedAt = data.updated_at;
        data.traderLevel = data.performance_tier;
        data.fullName = data.fullname;
        data.avatarUrl = data.profile_photo;
        data.isAdmin = data.is_admin || false;
        data.role = data.is_admin ? 'admin' : (data.role || 'user');
      }
      return data;
    },
    async findMany({ where = {}, orderBy, take, skip, select } = {}) {
      let query = supabase.from('user_profiles').select('*');
      if (where.isOnline !== undefined) query = query.eq('is_online', where.isOnline);
      if (where.traderLevel) query = query.eq('performance_tier', where.traderLevel);
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        const dbKey = key === 'isOnline' ? 'is_online' :
          key === 'lastSeen' ? 'last_seen' :
            key === 'createdAt' ? 'created_at' : key;
        query = query.order(dbKey, { ascending: orderBy[key] === 'asc' });
      }
      if (take) query = query.limit(take);
      if (skip) query = query.range(skip, skip + (take || 10) - 1);
      const { data, error } = await query;

      return (data || []).map(item => ({
        ...item,
        derivId: item.deriv_id,
        isOnline: item.is_online,
        lastSeen: item.last_seen,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        traderLevel: item.performance_tier,
        fullName: item.fullname,
        avatarUrl: item.profile_photo
      }));
    },
    async create({ data }) {

      const dbData = {
        id: data.id,
        deriv_id: data.derivId,
        username: data.username || data.derivId || `user_${data.derivId}`,
        fullname: data.fullName || data.fullname,
        email: data.email,
        country: data.country,
        profile_photo: data.avatarUrl,
        performance_tier: data.traderLevel || 'beginner',
        is_online: data.isOnline !== undefined ? data.isOnline : false,
        last_seen: data.lastSeen || new Date()
      };
      const { data: result, error } = await supabase.from('user_profiles').insert(dbData).select().single();
      if (error) throw error;

      if (result) {
        result.derivId = result.deriv_id;
        result.isOnline = result.is_online;
        result.lastSeen = result.last_seen;
        result.createdAt = result.created_at;
        result.updatedAt = result.updated_at;
        result.traderLevel = result.performance_tier;
        result.fullName = result.fullname;
        result.avatarUrl = result.profile_photo;
      }
      return result;
    },
    async update({ where, data }) {

      const dbData = {};
      if (data.isOnline !== undefined) dbData.is_online = data.isOnline;
      if (data.lastSeen) dbData.last_seen = data.lastSeen;
      if (data.country) dbData.country = data.country;
      if (data.fullName || data.fullname) dbData.fullname = data.fullName || data.fullname;
      if (data.email) dbData.email = data.email;
      if (data.avatarUrl) dbData.profile_photo = data.avatarUrl;
      if (data.traderLevel) dbData.performance_tier = data.traderLevel;
      // CRITICAL: Map refreshToken for auth to work
      if (data.refreshToken !== undefined) dbData.refresh_token = data.refreshToken;
      // Map isAdmin for admin access to work
      if (data.isAdmin !== undefined) dbData.is_admin = data.isAdmin;

      let query = supabase.from('user_profiles').update(dbData);
      if (where.id) query = query.eq('id', where.id);
      if (where.derivId) query = query.eq('deriv_id', where.derivId);
      const { data: result, error } = await query.select().single();
      if (error) throw error;

      if (result) {
        result.derivId = result.deriv_id;
        result.isOnline = result.is_online;
        result.lastSeen = result.last_seen;
        result.createdAt = result.created_at;
        result.updatedAt = result.updated_at;
        result.traderLevel = result.performance_tier;
        result.fullName = result.fullname;
        result.avatarUrl = result.profile_photo;
      }
      return result;
    },
    async upsert({ where, create, update }) {
      const existing = await this.findUnique({ where });
      if (existing) {
        return this.update({ where, data: update });
      }
      return this.create({ data: create });
    },
    async count({ where = {} } = {}) {
      let query = supabase.from('user_profiles').select('id', { count: 'exact', head: true });
      if (where.isOnline !== undefined) query = query.eq('is_online', where.isOnline);
      const { count } = await query;
      return count || 0;
    }
  },


  chatroom: {
    async findUnique({ where }) {
      const { data } = await supabase.from('Chatroom').select('*').eq('id', where.id).single();
      return data;
    },
    async findMany({ where = {}, orderBy, take } = {}) {
      let query = supabase.from('Chatroom').select('*');
      if (where.isActive !== undefined) query = query.eq('isActive', where.isActive);
      if (where.type) query = query.eq('type', where.type);
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        query = query.order(key, { ascending: orderBy[key] === 'asc' });
      }
      if (take) query = query.limit(take);
      const { data } = await query;
      return data || [];
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('Chatroom').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async upsert({ where, create, update }) {
      const existing = await this.findUnique({ where });
      if (existing) {

        const { data: result, error } = await supabase
          .from('Chatroom')
          .update(update)
          .eq('id', where.id)
          .select()
          .single();
        if (error) throw error;
        return result;
      }

      return this.create({ data: create });
    },
    async count({ where = {} } = {}) {
      let query = supabase.from('Chatroom').select('id', { count: 'exact', head: true });
      if (where.isActive !== undefined) query = query.eq('isActive', where.isActive);
      const { count } = await query;
      return count || 0;
    }
  },


  message: {
    async findMany({ where = {}, orderBy, take, include } = {}) {
      let query = supabase.from('Message').select('*');
      if (where.chatroomId) query = query.eq('chatroomId', where.chatroomId);
      if (where.senderId) query = query.eq('senderId', where.senderId);
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        query = query.order(key, { ascending: orderBy[key] === 'asc' });
      }
      if (take) query = query.limit(take);
      const { data } = await query;
      return data || [];
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('Message').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async update({ where, data }) {
      const { data: result, error } = await supabase.from('Message').update(data).eq('id', where.id).select().single();
      if (error) throw error;
      return result;
    },
    async delete({ where }) {
      const { error } = await supabase.from('Message').delete().eq('id', where.id);
      if (error) throw error;
    }
  },


  userChatroom: {
    async findUnique({ where }) {
      if (where.userId_chatroomId) {
        const { data } = await supabase
          .from('UserChatroom')
          .select('*')
          .eq('userId', where.userId_chatroomId.userId)
          .eq('chatroomId', where.userId_chatroomId.chatroomId)
          .single();
        return data;
      }
      return null;
    },
    async findMany({ where = {} } = {}) {
      let query = supabase.from('UserChatroom').select('*');
      if (where.userId) query = query.eq('userId', where.userId);
      if (where.chatroomId) query = query.eq('chatroomId', where.chatroomId);
      const { data } = await query;
      return data || [];
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('UserChatroom').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async update({ where, data }) {
      let query = supabase.from('UserChatroom').update(data);
      if (where.userId_chatroomId) {
        query = query
          .eq('userId', where.userId_chatroomId.userId)
          .eq('chatroomId', where.userId_chatroomId.chatroomId);
      }
      const { data: result, error } = await query.select().single();
      if (error) throw error;
      return result;
    },
    async count({ where = {} } = {}) {
      let query = supabase.from('UserChatroom').select('id', { count: 'exact', head: true });
      if (where.userId) query = query.eq('userId', where.userId);
      if (where.chatroomId) query = query.eq('chatroomId', where.chatroomId);
      const { count } = await query;
      return count || 0;
    }
  },


  friend: {
    async findFirst({ where }) {
      let query = supabase.from('Friend').select('*');
      if (where.userId) query = query.eq('userId', where.userId);
      if (where.friendId) query = query.eq('friendId', where.friendId);
      if (where.status) query = query.eq('status', where.status);
      const { data } = await query.limit(1).single();
      return data;
    },
    async findMany({ where = {} } = {}) {
      let query = supabase.from('Friend').select('*');
      if (where.userId) query = query.eq('userId', where.userId);
      if (where.friendId) query = query.eq('friendId', where.friendId);
      if (where.status) query = query.eq('status', where.status);
      const { data } = await query;
      return data || [];
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('Friend').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async update({ where, data }) {
      const { data: result, error } = await supabase.from('Friend').update(data).eq('id', where.id).select().single();
      if (error) throw error;
      return result;
    },
    async delete({ where }) {
      const { error } = await supabase.from('Friend').delete().eq('id', where.id);
      if (error) throw error;
    },
    async count({ where = {} } = {}) {
      let query = supabase.from('Friend').select('id', { count: 'exact', head: true });
      if (where.userId) query = query.eq('userId', where.userId);
      if (where.status) query = query.eq('status', where.status);
      const { count } = await query;
      return count || 0;
    }
  },


  communityPost: {
    async findUnique({ where }) {
      const { data } = await supabase.from('CommunityPost').select('*').eq('id', where.id).single();
      return data;
    },
    async findMany({ where = {}, orderBy, take, skip } = {}) {
      let query = supabase.from('CommunityPost').select('*');
      if (where.authorId) query = query.eq('authorId', where.authorId);
      if (where.category) query = query.eq('category', where.category);
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        query = query.order(key, { ascending: orderBy[key] === 'asc' });
      }
      if (take) query = query.limit(take);
      if (skip) query = query.range(skip, skip + (take || 10) - 1);
      const { data } = await query;
      return data || [];
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('CommunityPost').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async update({ where, data }) {
      const { data: result, error } = await supabase.from('CommunityPost').update(data).eq('id', where.id).select().single();
      if (error) throw error;
      return result;
    },
    async delete({ where }) {
      const { error } = await supabase.from('CommunityPost').delete().eq('id', where.id);
      if (error) throw error;
    },
    async count({ where = {} } = {}) {
      let query = supabase.from('CommunityPost').select('id', { count: 'exact', head: true });
      if (where.authorId) query = query.eq('authorId', where.authorId);
      const { count } = await query;
      return count || 0;
    }
  },


  postComment: {
    async findMany({ where = {}, orderBy } = {}) {
      let query = supabase.from('PostComment').select('*');
      if (where.postId) query = query.eq('postId', where.postId);
      if (where.authorId) query = query.eq('authorId', where.authorId);
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        query = query.order(key, { ascending: orderBy[key] === 'asc' });
      }
      const { data } = await query;
      return data || [];
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('PostComment').insert(data).select().single();
      if (error) throw error;
      return result;
    }
  },


  postLike: {
    async findUnique({ where }) {
      if (where.postId_userId) {
        const { data } = await supabase
          .from('PostLike')
          .select('*')
          .eq('postId', where.postId_userId.postId)
          .eq('userId', where.postId_userId.userId)
          .single();
        return data;
      }
      return null;
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('PostLike').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async delete({ where }) {
      if (where.postId_userId) {
        await supabase
          .from('PostLike')
          .delete()
          .eq('postId', where.postId_userId.postId)
          .eq('userId', where.postId_userId.userId);
      }
    }
  },


  refreshToken: {
    async findUnique({ where }) {
      const { data } = await supabase.from('RefreshToken').select('*').eq('token', where.token).single();
      return data;
    },
    async create({ data }) {
      const { data: result, error } = await supabase.from('RefreshToken').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async delete({ where }) {
      if (where.token) {
        await supabase.from('RefreshToken').delete().eq('token', where.token);
      }
    },
    async deleteMany({ where }) {
      let query = supabase.from('RefreshToken').delete();
      if (where.userId) query = query.eq('userId', where.userId);
      await query;
    }
  },


  moderationLog: {
    async create({ data }) {
      const { data: result, error } = await supabase.from('ModerationLog').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    async findMany({ where = {}, orderBy, take } = {}) {
      let query = supabase.from('ModerationLog').select('*');
      if (where.userId) query = query.eq('userId', where.userId);
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        query = query.order(key, { ascending: orderBy[key] === 'asc' });
      }
      if (take) query = query.limit(take);
      const { data } = await query;
      return data || [];
    }
  },


  notification: {
    async create({ data }) {
      console.log('Notification:', data);
      return data;
    }
  }
};

module.exports = { db, prisma: db, supabase };

