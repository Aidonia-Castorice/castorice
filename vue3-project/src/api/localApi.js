/**
 * 本地模式API处理器
 * 拦截普通用户的写操作，将数据存储在浏览器本地
 * 读操作中的公共数据仍从服务器获取，再合并本地数据
 */
import * as db from '@/utils/localDB.js'
import { getRandomAvatar } from '@/utils/avatar.js'

// 模拟网络延迟
const delay = (ms = 200) => new Promise(r => setTimeout(r, ms))

function success(data = null, message = 'success') {
  return Promise.resolve({ success: true, message, data })
}

function fail(message = '操作失败', code = 400) {
  return Promise.resolve({ success: false, message, data: null })
}

// 获取当前本地用户
function currentUser() {
  return db.getCurrentLocalUser()
}

// 文件转data URL（本地模式持久化）
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 处理上传：返回data URL以持久化到localStorage
async function handleUpload(formData) {
  const file = formData.get('file')
  if (file && file instanceof Blob) {
    const dataUrl = await fileToDataURL(file)
    return success({ url: dataUrl, originalName: file.name || 'image.png', size: file.size })
  }
  return success({ url: getRandomAvatar(), originalName: 'image.png', size: 0 })
}

// 处理批量上传
async function handleBatchUpload(files) {
  const uploaded = []
  for (const file of files) {
    if (file instanceof Blob) {
      const dataUrl = await fileToDataURL(file)
      uploaded.push({ url: dataUrl, originalName: file.name, size: file.size })
    }
  }
  return success({
    uploaded,
    errors: [],
    total: files.length,
    successCount: uploaded.length,
    errorCount: 0
  })
}

// 主路由：处理本地模式的请求
export async function handleLocalRequest(method, url, data, config = {}) {
  await delay(150 + Math.random() * 200)
  const user = currentUser()
  const m = method.toUpperCase()

  // ========== 认证相关 ==========
  if (url === '/auth/logout' && m === 'POST') {
    db.clearCurrentLocalUser()
    db.setLocalMode(false)
    return success(null, '退出成功')
  }

  if (url === '/auth/me' && m === 'GET') {
    if (!user) return fail('未登录', 401)
    const fresh = db.findLocalUser(user.user_id)
    if (fresh) {
      const safe = { ...fresh }
      delete safe.password
      db.setCurrentLocalUser(safe)
      return success(safe)
    }
    return fail('用户不存在', 404)
  }

  if (url === '/auth/refresh' && m === 'POST') {
    return success({ access_token: 'local_token', refresh_token: 'local_refresh', expires_in: 3600 })
  }

  // ========== 用户资料 ==========
  let match
  if (m === 'PUT' && (match = url.match(/^\/users\/(.+)$/))) {
    const userId = decodeURIComponent(match[1])
    if (!user) return fail('未登录', 401)
    const updated = db.updateLocalUser(user.user_id, data)
    if (updated) {
      const safe = { ...updated }
      delete safe.password
      return success(safe)
    }
    return fail('更新失败')
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)\/stats$/))) {
    const userId = decodeURIComponent(match[1])
    const posts = db.getUserLocalPosts(userId)
    const totalLikes = posts.reduce((sum, p) => sum + (p.like_count || 0), 0)
    return success({ post_count: posts.length, like_count: totalLikes, collect_count: 0 })
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)\/posts$/))) {
    const userId = decodeURIComponent(match[1])
    const posts = db.getUserLocalPosts(userId)
    return success({
      posts,
      pagination: { page: 1, limit: 20, total: posts.length, pages: 1 }
    })
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)\/collections$/))) {
    const userId = decodeURIComponent(match[1])
    const collections = db.getLocalCollections().filter(c => c.user_id === user?.id)
    const posts = db.getLocalPosts().filter(p => collections.some(c => c.post_id === p.id))
    return success({
      posts,
      pagination: { page: 1, limit: 20, total: posts.length, pages: 1 }
    })
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)\/following$/))) {
    if (!user) return success({ users: [], pagination: { total: 0 } })
    const follows = db.getLocalFollows().filter(f => f.follower_id === user.id)
    return success({ users: [], pagination: { total: follows.length } })
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)\/followers$/))) {
    return success({ users: [], pagination: { total: 0 } })
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)\/mutual-follows$/))) {
    return success({ users: [], pagination: { total: 0 } })
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)\/follow-status$/))) {
    return success({ following: false })
  }

  if (m === 'POST' && (match = url.match(/^\/users\/([^/]+)\/follow$/))) {
    if (!user) return fail('未登录', 401)
    db.addLocalFollow(user.id, match[1])
    return success()
  }

  if (m === 'DELETE' && (match = url.match(/^\/users\/([^/]+)\/follow$/))) {
    if (!user) return fail('未登录', 401)
    db.removeLocalFollow(user.id, match[1])
    return success()
  }

  if (m === 'GET' && (match = url.match(/^\/users\/([^/]+)$/))) {
    const userId = decodeURIComponent(match[1])
    const u = db.findLocalUser(userId)
    if (u) {
      const safe = { ...u }
      delete safe.password
      return success(safe)
    }
    // 本地找不到，返回null让调用方走服务器
    return null
  }

  // ========== 帖子相关 ==========
  if (url === '/posts' && m === 'POST') {
    if (!user) return fail('未登录', 401)
    const images = data.images || []
    const post = db.createLocalPost({
      userId: user.id,
      title: data.title || '',
      content: data.content || '',
      category_id: data.category_id,
      type: data.type || 1,
      images,
      video_url: data.video_url || null,
      nickname: user.nickname,
      user_avatar: user.avatar,
      author_account: user.user_id,
      location: user.location || '未知',
      tags: data.tags || []
    })
    return success(post)
  }

  if (url === '/posts/following' && m === 'GET') {
    return success({ posts: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } })
  }

  if (m === 'PUT' && (match = url.match(/^\/posts\/(\d+)$/))) {
    if (!user) return fail('未登录', 401)
    const posts = db.getLocalPosts()
    const idx = posts.findIndex(p => p.id === Number(match[1]) && p.user_id === user.id)
    if (idx === -1) return fail('帖子不存在')
    posts[idx] = { ...posts[idx], ...data }
    db.saveLocalPosts(posts)
    return success(posts[idx])
  }

  if (m === 'DELETE' && (match = url.match(/^\/posts\/(\d+)$/))) {
    if (!user) return fail('未登录', 401)
    const ok = db.deleteLocalPost(Number(match[1]), user.id)
    return ok ? success() : fail('删除失败')
  }

  // 草稿列表
  if (url.startsWith('/posts') && m === 'GET' && config.params?.status === 1) {
    const posts = db.getLocalPosts().filter(p => p.user_id === user?.id && p.status === 1)
    return success({ posts, pagination: { page: 1, limit: 20, total: posts.length, pages: 1 } })
  }

  // ========== 点赞 ==========
  if (url === '/likes' && m === 'POST') {
    if (!user) return fail('未登录', 401)
    db.addLocalLike(user.id, data.target_type, data.target_id)
    return success()
  }

  if (url === '/likes' && m === 'DELETE') {
    if (!user) return fail('未登录', 401)
    db.removeLocalLike(user.id, data.target_type, data.target_id)
    return success()
  }

  // ========== 收藏 ==========
  if (m === 'POST' && (match = url.match(/^\/posts\/(\d+)\/collect$/))) {
    if (!user) return fail('未登录', 401)
    db.addLocalCollection(user.id, Number(match[1]))
    return success()
  }

  if (m === 'DELETE' && (match = url.match(/^\/posts\/(\d+)\/collect$/))) {
    if (!user) return fail('未登录', 401)
    db.removeLocalCollection(user.id, Number(match[1]))
    return success()
  }

  // ========== 评论 ==========
  if (url === '/comments' && m === 'POST') {
    if (!user) return fail('未登录', 401)
    const comment = db.createLocalComment({
      post_id: data.post_id,
      user_id: user.id,
      nickname: user.nickname,
      user_avatar: user.avatar,
      content: data.content,
      parent_id: data.parent_id || null
    })
    return success(comment)
  }

  if (m === 'DELETE' && (match = url.match(/^\/comments\/(\d+)$/))) {
    if (!user) return fail('未登录', 401)
    const ok = db.deleteLocalComment(Number(match[1]), user.id)
    return ok ? success() : fail('删除失败')
  }

  if (m === 'GET' && (match = url.match(/^\/comments\/(\d+)\/replies$/))) {
    return success({ comments: [], pagination: { total: 0 } })
  }

  // ========== 通知 ==========
  if (url.startsWith('/notifications') && m === 'GET') {
    if (!user) return success({ notifications: [], pagination: { total: 0 } })
    const notifications = db.getLocalNotifications(user.id)
    return success({ notifications, pagination: { page: 1, limit: 20, total: notifications.length, pages: 1 } })
  }

  if (m === 'PUT' && url.match(/^\/notifications\/\d+\/read$/)) {
    const id = Number(url.match(/\d+/)[0])
    db.markNotificationRead(id)
    return success()
  }

  if (url === '/notifications/read-all' && m === 'PUT') {
    if (user) db.markAllNotificationsRead(user.id)
    return success()
  }

  if (url === '/notifications/unread-count' && m === 'GET') {
    if (!user) return success({ count: 0 })
    const count = db.getLocalNotifications(user.id).filter(n => !n.is_read).length
    return success({ count })
  }

  if (url === '/notifications/unread-count-by-type' && m === 'GET') {
    return success({ comments: 0, likes: 0, follows: 0, collections: 0 })
  }

  if (m === 'DELETE' && url.match(/^\/notifications\/\d+$/)) {
    return success()
  }

  // ========== 上传 ==========
  if (url === '/upload/single' && m === 'POST') {
    return handleUpload(data)
  }

  if (url === '/upload/multiple' && m === 'POST') {
    return handleBatchUpload(data.getAll ? data.getAll('files') : [])
  }

  // ========== 搜索 ==========
  if ((url === '/search' || url.startsWith('/search/')) && m === 'GET') {
    // 本地搜索本地帖子
    const keyword = config.params?.keyword || ''
    let posts = db.getLocalPosts().filter(p => p.status === 0)
    if (keyword) {
      posts = posts.filter(p =>
        (p.title && p.title.includes(keyword)) ||
        (p.content && p.content.includes(keyword))
      )
    }
    return success({
      posts,
      users: [],
      tags: [],
      pagination: { page: 1, limit: 20, total: posts.length, pages: 1 }
    })
  }

  // ========== 标签/分类（本地返回空，让组件走服务器） ==========
  if (url === '/categories' && m === 'GET') return null
  if (url.startsWith('/tags') && m === 'GET') return null

  // ========== 帖子详情（本地帖子） ==========
  if (m === 'GET' && (match = url.match(/^\/posts\/(\d+)$/))) {
    const postId = Number(match[1])
    const localPost = db.getLocalPosts().find(p => p.id === postId)
    if (localPost) {
      const comments = db.getCommentsForPost(postId)
      return success({ ...localPost, comments })
    }
    return null // 让服务器处理
  }

  // ========== 评论列表（本地帖子的评论） ==========
  if (m === 'GET' && (match = url.match(/^\/posts\/(\d+)\/comments$/))) {
    const postId = Number(match[1])
    const localPost = db.getLocalPosts().find(p => p.id === postId)
    if (localPost) {
      const comments = db.getCommentsForPost(postId)
      return success({ comments, pagination: { total: comments.length } })
    }
    return null // 服务器帖子的评论走服务器
  }

  // ========== 邮件相关（本地模式不启用） ==========
  if (url === '/auth/email-config' && m === 'GET') {
    return success({ emailEnabled: false })
  }
  if (url === '/auth/send-email-code' && m === 'POST') {
    return fail('邮件功能未启用')
  }

  // 默认：返回null表示走服务器
  return null
}

// 将本地交互状态合并到服务器返回的帖子列表中
export function mergeLocalIntoPosts(serverPosts) {
  const user = db.getCurrentLocalUser()
  if (!user || !Array.isArray(serverPosts)) return serverPosts

  const localPosts = db.getLocalPosts().filter(p => p.status === 0)
  const localLikes = db.getLocalLikes().filter(l => l.user_id === user.id)
  const localCollections = db.getLocalCollections().filter(c => c.user_id === user.id)

  // 合并本地帖子到列表前面
  const merged = [...localPosts, ...serverPosts]

  // 应用本地点赞/收藏状态
  return merged.map(post => {
    const liked = localLikes.some(l => l.target_type === 1 && l.target_id === post.id)
    const collected = localCollections.some(c => c.post_id === post.id)
    return { ...post, liked: post.liked || liked, collected: post.collected || collected }
  })
}

// 将本地评论合并到服务器评论中
export function mergeLocalComments(postId, serverComments) {
  const localComments = db.getCommentsForPost(postId)
  if (localComments.length === 0) return serverComments
  return [...localComments, ...(serverComments || [])]
}
