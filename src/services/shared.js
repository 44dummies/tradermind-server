

const { supabase } = require('../db/supabase');

const SharedService = {
  
  
  

  
  async getNotes(chatId) {
    const { data, error } = await supabase
      .from('shared_notes')
      .select(`
        *,
        last_editor:user_profiles!shared_notes_last_edited_by_fkey(
          id, username, fullname
        )
      `)
      .eq('chat_id', chatId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    
    if (!data) {
      const { data: newNotes, error: createError } = await supabase
        .from('shared_notes')
        .insert({
          chat_id: chatId,
          title: 'Our Trading Notes',
          content: '# Welcome! 📝\n\nThis is your shared notes space.\n\n## Ideas\n- \n\n## Strategies\n- '
        })
        .select()
        .single();
      
      if (createError) throw createError;
      return newNotes;
    }
    
    return data;
  },

  
  async updateNotes(chatId, userId, content, title = null) {
    const updates = {
      content,
      last_edited_by: userId,
      updated_at: new Date().toISOString()
    };
    
    if (title) updates.title = title;
    
    
    const { data: current } = await supabase
      .from('shared_notes')
      .select('version')
      .eq('chat_id', chatId)
      .single();
    
    if (current) {
      updates.version = (current.version || 0) + 1;
    }
    
    const { data, error } = await supabase
      .from('shared_notes')
      .update(updates)
      .eq('chat_id', chatId)
      .select(`
        *,
        last_editor:user_profiles!shared_notes_last_edited_by_fkey(
          id, username, fullname
        )
      `)
      .single();
    
    if (error) throw error;
    
    
    const { data: chat } = await supabase
      .from('friend_chats')
      .select('user1_id, user2_id')
      .eq('id', chatId)
      .single();
    
    if (chat) {
      const otherUserId = chat.user1_id === userId ? chat.user2_id : chat.user1_id;
      await supabase
        .from('notifications')
        .insert({
          user_id: otherUserId,
          type: 'notes_edit',
          title: 'Shared Notes Updated',
          message: 'Your friend updated the shared notes',
          related_user_id: userId,
          related_chat_id: chatId
        });
    }
    
    return data;
  },

  
  
  

  
  async getWatchlist(chatId) {
    const { data, error } = await supabase
      .from('shared_watchlists')
      .select('*')
      .eq('chat_id', chatId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    
    if (!data) {
      const { data: newWatchlist, error: createError } = await supabase
        .from('shared_watchlists')
        .insert({
          chat_id: chatId,
          name: 'Our Watchlist',
          symbols: [],
          strategies: [],
          timeframes: []
        })
        .select()
        .single();
      
      if (createError) throw createError;
      return newWatchlist;
    }
    
    return data;
  },

  
  async addSymbol(chatId, userId, symbolData) {
    const { symbol, notes = '' } = symbolData;
    
    const watchlist = await this.getWatchlist(chatId);
    const symbols = watchlist.symbols || [];
    
    
    if (symbols.some(s => s.symbol === symbol)) {
      throw new Error('Symbol already in watchlist');
    }
    
    
    const { data: user } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('id', userId)
      .single();
    
    symbols.push({
      symbol,
      notes,
      addedBy: user?.username || 'Unknown',
      addedById: userId,
      addedAt: new Date().toISOString()
    });
    
    const { data, error } = await supabase
      .from('shared_watchlists')
      .update({
        symbols,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async removeSymbol(chatId, symbol) {
    const watchlist = await this.getWatchlist(chatId);
    const symbols = (watchlist.symbols || []).filter(s => s.symbol !== symbol);
    
    const { data, error } = await supabase
      .from('shared_watchlists')
      .update({
        symbols,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async updateSymbolNotes(chatId, symbol, notes) {
    const watchlist = await this.getWatchlist(chatId);
    const symbols = watchlist.symbols || [];
    
    const index = symbols.findIndex(s => s.symbol === symbol);
    if (index === -1) throw new Error('Symbol not found');
    
    symbols[index].notes = notes;
    symbols[index].updatedAt = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('shared_watchlists')
      .update({
        symbols,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async addStrategy(chatId, userId, strategy) {
    const watchlist = await this.getWatchlist(chatId);
    const strategies = watchlist.strategies || [];
    
    const { data: user } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('id', userId)
      .single();
    
    strategies.push({
      ...strategy,
      addedBy: user?.username || 'Unknown',
      addedById: userId,
      addedAt: new Date().toISOString()
    });
    
    const { data, error } = await supabase
      .from('shared_watchlists')
      .update({
        strategies,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async updateTimeframes(chatId, timeframes) {
    const { data, error } = await supabase
      .from('shared_watchlists')
      .update({
        timeframes,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async renameWatchlist(chatId, name) {
    const { data, error } = await supabase
      .from('shared_watchlists')
      .update({
        name,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

module.exports = SharedService;
