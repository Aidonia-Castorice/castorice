/**
 * 本地数据库工具模块
 * 为普通用户提供纯浏览器本地的数据存储，模拟后端API行为
 * 所有数据保存在 localStorage 中，清除浏览器数据后消失
 */
import { getRandomAvatar } from './avatar.js'

const STORAGE_PREFIX = 'fufu_local_'

// 存储键名
const KEYS = {
  USERS: STORAGE_PREFIX + 'users',
  CURRENT_USER: STORAGE_PREFIX + 'current_user',
  POSTS: STORAGE_PREFIX + 'posts',
  COMMENTS: STORAGE_PREFIX + 'comments',
  LIKES: STORAGE_PREFIX + 'likes',
  COLLECTIONS: STORAGE_PREFIX + 'collections',
  FOLLOWS: STORAGE_PREFIX + 'follows',
  NOTIFICATIONS: STORAGE_PREFIX + 'notifications',
  POST_IMAGES: STORAGE_PREFIX + 'post_images'
}

// 简单哈希函数（仅用于本地演示，非安全加密）
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return String(hash)
}

// 通用读写
function read(key, defaultValue) {
  try {
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : defaultValue
  } catch {
    return defaultValue
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

// 生成唯一ID
function genId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000)
}

// ========== 用户相关 ==========
export function getLocalUsers() {
  return read(KEYS.USERS, [])
}

export function findLocalUser(userId) {
  const users = getLocalUsers()
  return users.find(u => u.user_id === userId)
}

export function createLocalUser({ user_id, nickname, password, email = '' }) {
  const users = getLocalUsers()
  if (users.find(u => u.user_id === user_id)) {
    return { success: false, message: 'UID已存在' }
  }
  const now = new Date().toISOString()
  const user = {
    id: genId(),
    user_id,
    nickname,
    password: simpleHash(password),
    email,
    avatar: getRandomAvatar(),
    bio: '用户没有任何简介',
    location: '未知',
    gender: '',
    zodiac_sign: '',
    mbti: '',
    education: '',
    major: '',
    interests: [],
    follow_count: 0,
    fans_count: 0,
    like_count: 0,
    is_active: 1,
    verified: 0,
    created_at: now,
    updated_at: now
  }
  users.push(user)
  write(KEYS.USERS, users)
  return { success: true, user }
}

export function verifyLocalUser(userId, password) {
  const user = findLocalUser(userId)
  if (!user) return { success: false, message: '用户不存在' }
  if (user.password !== simpleHash(password)) {
    return { success: false, message: '密码错误' }
  }
  if (!user.is_active) return { success: false, message: '账户已被禁用' }
  return { success: true, user }
}

export function setCurrentLocalUser(user) {
  const safeUser = { ...user }
  delete safeUser.password
  write(KEYS.CURRENT_USER, safeUser)
}

export function getCurrentLocalUser() {
  return read(KEYS.CURRENT_USER, null)
}

export function clearCurrentLocalUser() {
  localStorage.removeItem(KEYS.CURRENT_USER)
}

export function updateLocalUser(userId, updates) {
  const users = getLocalUsers()
  const idx = users.findIndex(u => u.user_id === userId)
  if (idx === -1) return null
  users[idx] = { ...users[idx], ...updates, updated_at: new Date().toISOString() }
  write(KEYS.USERS, users)
  // 如果是当前登录用户，同步更新
  const current = getCurrentLocalUser()
  if (current && current.user_id === userId) {
    const safeUser = { ...users[idx] }
    delete safeUser.password
    setCurrentLocalUser(safeUser)
  }
  return users[idx]
}

// ========== 帖子相关 ==========
export function getLocalPosts() {
  return read(KEYS.POSTS, [])
}

export function saveLocalPosts(posts) {
  write(KEYS.POSTS, posts)
}

export function createLocalPost(postData) {
  const posts = getLocalPosts()
  const now = new Date().toISOString()
  const post = {
    id: genId(),
    user_id: postData.userId,
    title: postData.title || '',
    content: postData.content || '',
    category_id: postData.category_id || null,
    type: postData.type || 1,
    view_count: 0,
    like_count: 0,
    collect_count: 0,
    comment_count: 0,
    created_at: now,
    status: 0,
    nickname: postData.nickname,
    user_avatar: postData.user_avatar,
    author_account: postData.author_account,
    author_auto_id: postData.userId,
    location: postData.location || '未知',
    verified: 0,
    category: postData.category || null,
    images: postData.images || [],
    image: (postData.images && postData.images[0]) || null,
    video_url: postData.video_url || null,
    tags: postData.tags || [],
    liked: false,
    collected: false
  }
  posts.unshift(post)
  saveLocalPosts(posts)
  // 保存图片关联
  if (postData.images && postData.images.length > 0) {
    const allImages = read(KEYS.POST_IMAGES, {})
    allImages[post.id] = postData.images
    write(KEYS.POST_IMAGES, allImages)
  }
  return post
}

export function deleteLocalPost(postId, userId) {
  const posts = getLocalPosts()
  const idx = posts.findIndex(p => p.id === postId && p.user_id === userId)
  if (idx === -1) return false
  posts.splice(idx, 1)
  saveLocalPosts(posts)
  // 清理关联数据
  const comments = getLocalComments().filter(c => c.post_id !== postId)
  write(KEYS.COMMENTS, comments)
  return true
}

export function getUserLocalPosts(userId) {
  return getLocalPosts().filter(p => p.user_id === userId && p.status === 0)
}

// ========== 评论相关 ==========
export function getLocalComments() {
  return read(KEYS.COMMENTS, [])
}

export function getCommentsForPost(postId) {
  return getLocalComments().filter(c => c.post_id === postId)
}

export function createLocalComment({ post_id, user_id, nickname, user_avatar, content, parent_id = null }) {
  const comments = getLocalComments()
  const now = new Date().toISOString()
  const comment = {
    id: genId(),
    post_id,
    user_id,
    parent_id,
    content,
    like_count: 0,
    created_at: now,
    nickname,
    user_avatar,
    author_account: nickname,
    author_auto_id: user_id,
    replies: []
  }
  comments.push(comment)
  write(KEYS.COMMENTS, comments)
  // 更新帖子评论数
  const posts = getLocalPosts()
  const post = posts.find(p => p.id === post_id)
  if (post) {
    post.comment_count = (post.comment_count || 0) + 1
    saveLocalPosts(posts)
  }
  return comment
}

export function deleteLocalComment(commentId, userId) {
  const comments = getLocalComments()
  const idx = comments.findIndex(c => c.id === commentId && c.user_id === userId)
  if (idx === -1) return false
  const postId = comments[idx].post_id
  comments.splice(idx, 1)
  write(KEYS.COMMENTS, comments)
  const posts = getLocalPosts()
  const post = posts.find(p => p.id === postId)
  if (post && post.comment_count > 0) {
    post.comment_count--
    saveLocalPosts(posts)
  }
  return true
}

// ========== 点赞相关 ==========
export function getLocalLikes() {
  return read(KEYS.LIKES, [])
}

export function hasLocalLiked(userId, targetType, targetId) {
  return getLocalLikes().some(l => l.user_id === userId && l.target_type === targetType && l.target_id === targetId)
}

export function addLocalLike(userId, targetType, targetId) {
  const likes = getLocalLikes()
  if (likes.some(l => l.user_id === userId && l.target_type === targetType && l.target_id === targetId)) {
    return
  }
  likes.push({ id: genId(), user_id: userId, target_type: targetType, target_id: targetId, created_at: new Date().toISOString() })
  write(KEYS.LIKES, likes)
  // 更新计数
  if (targetType === 1) {
    const posts = getLocalPosts()
    const post = posts.find(p => p.id === targetId)
    if (post) { post.like_count = (post.like_count || 0) + 1; saveLocalPosts(posts) }
  }
}

export function removeLocalLike(userId, targetType, targetId) {
  let likes = getLocalLikes()
  const before = likes.length
  likes = likes.filter(l => !(l.user_id === userId && l.target_type === targetType && l.target_id === targetId))
  write(KEYS.LIKES, likes)
  if (likes.length < before && targetType === 1) {
    const posts = getLocalPosts()
    const post = posts.find(p => p.id === targetId)
    if (post && post.like_count > 0) { post.like_count--; saveLocalPosts(posts) }
  }
}

// ========== 收藏相关 ==========
export function getLocalCollections() {
  return read(KEYS.COLLECTIONS, [])
}

export function hasLocalCollected(userId, postId) {
  return getLocalCollections().some(c => c.user_id === userId && c.post_id === postId)
}

export function addLocalCollection(userId, postId) {
  const collections = getLocalCollections()
  if (collections.some(c => c.user_id === userId && c.post_id === postId)) return
  collections.push({ id: genId(), user_id: userId, post_id: postId, created_at: new Date().toISOString() })
  write(KEYS.COLLECTIONS, collections)
  const posts = getLocalPosts()
  const post = posts.find(p => p.id === postId)
  if (post) { post.collect_count = (post.collect_count || 0) + 1; saveLocalPosts(posts) }
}

export function removeLocalCollection(userId, postId) {
  let collections = getLocalCollections()
  const before = collections.length
  collections = collections.filter(c => !(c.user_id === userId && c.post_id === postId))
  write(KEYS.COLLECTIONS, collections)
  if (collections.length < before) {
    const posts = getLocalPosts()
    const post = posts.find(p => p.id === postId)
    if (post && post.collect_count > 0) { post.collect_count--; saveLocalPosts(posts) }
  }
}

// ========== 关注相关 ==========
export function getLocalFollows() {
  return read(KEYS.FOLLOWS, [])
}

export function isLocalFollowing(followerId, followingId) {
  return getLocalFollows().some(f => f.follower_id === followerId && f.following_id === followingId)
}

export function addLocalFollow(followerId, followingId) {
  const follows = getLocalFollows()
  if (follows.some(f => f.follower_id === followerId && f.following_id === followingId)) return
  follows.push({ id: genId(), follower_id: followerId, following_id: followingId, created_at: new Date().toISOString() })
  write(KEYS.FOLLOWS, follows)
}

export function removeLocalFollow(followerId, followingId) {
  let follows = getLocalFollows()
  follows = follows.filter(f => !(f.follower_id === followerId && f.following_id === followingId))
  write(KEYS.FOLLOWS, follows)
}

// ========== 通知相关 ==========
export function getLocalNotifications(userId) {
  return read(KEYS.NOTIFICATIONS, []).filter(n => n.user_id === userId)
}

export function addLocalNotification(notification) {
  const notifications = read(KEYS.NOTIFICATIONS, [])
  notifications.unshift({ id: genId(), is_read: 0, created_at: new Date().toISOString(), ...notification })
  write(KEYS.NOTIFICATIONS, notifications)
}

export function markNotificationRead(notificationId) {
  const notifications = read(KEYS.NOTIFICATIONS, [])
  const n = notifications.find(x => x.id === notificationId)
  if (n) { n.is_read = 1; write(KEYS.NOTIFICATIONS, notifications) }
}

export function markAllNotificationsRead(userId) {
  const notifications = read(KEYS.NOTIFICATIONS, [])
  notifications.forEach(n => { if (n.user_id === userId) n.is_read = 1 })
  write(KEYS.NOTIFICATIONS, notifications)
}

// ========== 工具函数 ==========
// 判断是否为本地模式
export function isLocalMode() {
  return localStorage.getItem(STORAGE_PREFIX + 'mode') === 'local'
}

export function setLocalMode(enabled) {
  if (enabled) {
    localStorage.setItem(STORAGE_PREFIX + 'mode', 'local')
  } else {
    localStorage.removeItem(STORAGE_PREFIX + 'mode')
  }
}

// 站主UID常量
export const SITE_OWNER_UID = '小蝶书'

// 判断是否为站主UID（密码由服务器验证，不硬编码）
export function isSiteOwnerUid(userId) {
  return userId === SITE_OWNER_UID
}

// 兼容旧调用：判断是否为站主登录凭据（仅检查UID，密码由服务器验证）
export function isSiteOwnerCredentials(userId, password) {
  return userId === SITE_OWNER_UID
}
