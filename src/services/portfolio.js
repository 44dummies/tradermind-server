

const { supabase } = require('../db/supabase');

const PortfolioService = {
  
  async addItem(userId, itemData) {
    const {
      media_type,
      title,
      description,
      local_filename,
      thumbnail_data, 
      tags = [],
      privacy_level = 'public'
    } = itemData;
    
    const { data, error } = await supabase
      .from('portfolio_items')
      .insert({
        user_id: userId,
        media_type,
        title,
        description,
        local_filename,
        thumbnail_data,
        tags,
        privacy_level
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async getUserPortfolio(userId, viewerId = null) {
    let query = supabase
      .from('portfolio_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    
    if (viewerId !== userId) {
      
      const { data: friendship } = await supabase
        .from('friendships')
        .select('status')
        .eq('user_id', userId)
        .eq('friend_id', viewerId)
        .eq('status', 'accepted')
        .single();
      
      if (friendship) {
        
        query = query.in('privacy_level', ['public', 'friends_only']);
      } else {
        
        query = query.eq('privacy_level', 'public');
      }
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  
  async updateItem(itemId, userId, updates) {
    const { data, error } = await supabase
      .from('portfolio_items')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async deleteItem(itemId, userId) {
    const { error } = await supabase
      .from('portfolio_items')
      .delete()
      .eq('id', itemId)
      .eq('user_id', userId);
    
    if (error) throw error;
    return { success: true };
  },

  
  async toggleLike(itemId, userId) {
    
    
    const { data: item } = await supabase
      .from('portfolio_items')
      .select('likes_count')
      .eq('id', itemId)
      .single();
    
    if (!item) throw new Error('Item not found');
    
    
    const { error } = await supabase
      .from('portfolio_items')
      .update({ likes_count: item.likes_count + 1 })
      .eq('id', itemId);
    
    if (error) throw error;
    
    
    if (item.likes_count + 1 >= 100) {
      const { data: itemOwner } = await supabase
        .from('portfolio_items')
        .select('user_id')
        .eq('id', itemId)
        .single();
      
      if (itemOwner) {
        await supabase
          .from('achievements')
          .upsert({
            user_id: itemOwner.user_id,
            achievement_type: 'portfolio_star',
            achievement_name: 'Portfolio Star',
            achievement_icon: '⭐',
            description: 'Received 100+ likes on portfolio'
          }, { onConflict: 'user_id,achievement_type' });
      }
    }
    
    return { success: true, new_count: item.likes_count + 1 };
  },

  
  async incrementViews(itemId) {
    const { error } = await supabase.rpc('increment_portfolio_views', {
      item_id: itemId
    });
    
    
    if (error) {
      const { data: item } = await supabase
        .from('portfolio_items')
        .select('views_count')
        .eq('id', itemId)
        .single();
      
      if (item) {
        await supabase
          .from('portfolio_items')
          .update({ views_count: (item.views_count || 0) + 1 })
          .eq('id', itemId);
      }
    }
  }
};

module.exports = PortfolioService;
