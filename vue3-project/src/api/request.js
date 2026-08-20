import axios from 'axios'
import apiConfig from '@/config/api.js'
import { HTTP_STATUS, ERROR_MESSAGES } from '@/config/constants.js'
import messageManager from '@/utils/messageManager.js'
import { isLocalMode } from '@/utils/localDB.js'
import * as db from '@/utils/localDB.js'
import { handleLocalRequest, mergeLocalComments } from './localApi.js'

// 创建axios实例
const request = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
  headers: apiConfig.defaultHeaders
})

// 判断是否为写操作
function isWriteMethod(method) {
  return ['post', 'put', 'delete', 'patch'].includes(method.toLowerCase())
}

// 请求拦截器
request.interceptors.request.use(
  async config => {
    const localMode = isLocalMode()
    const isAdminRequest = config.url && config.url.includes('/auth/admin/')
    const isInAdminPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')

    if (localMode && !isAdminRequest && !isInAdminPage) {
      const method = (config.method || 'get').toLowerCase()
      const needsLocal = isWriteMethod(method) ||
        config.url === '/auth/me' ||
        config.url === '/auth/refresh' ||
        config.url === '/auth/logout' ||
        config.url?.startsWith('/notifications') ||
        config.url?.includes('/follow') ||
        config.url?.includes('/collect') ||
        (config.url?.startsWith('/users/') && method === 'get') ||
        config.url === '/upload/single' ||
        config.url === '/upload/multiple' ||
        config.url === '/posts/following' ||
        (config.url === '/posts' && method === 'get' && config.params?.status === 1) ||
        config.url?.startsWith('/search')

      if (needsLocal) {
        let reqData = config.data
        if (typeof reqData === 'string') {
          try { reqData = JSON.parse(reqData) } catch { /* keep as string */ }
        }
        const localResult = await handleLocalRequest(method, config.url, reqData, { params: config.params })
        if (localResult !== null) {
          return Promise.reject({
            __localHandled: true,
            response: {
              status: 200,
              data: { code: localResult.success ? 200 : 400, message: localResult.message, data: localResult.data },
              __localHandled: true,
              __localSuccess: localResult.success
            }
          })
        }
      }
    }

    if (isAdminRequest || isInAdminPage) {
      const adminToken = localStorage.getItem('admin_token')
      if (adminToken) {
        config.headers.Authorization = `Bearer ${adminToken}`
      }
    } else {
      const token = localStorage.getItem('token')
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    }
    return config
  },
  error => {
    console.error('❌ 请求配置错误:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    if (response.data && response.data.hasOwnProperty('code')) {
      const result = {
        success: response.data.code === HTTP_STATUS.OK,
        message: response.data.message,
        data: response.data.data
      }
      // 本地模式：合并本地数据到服务器响应
      if (isLocalMode() && response.config?.url) {
        return postProcessResponse(response.config.url, result, response.config.params)
      }
      return result
    }
    return response.data
  },
  async error => {
    // 本地模式处理的响应
    if (error.__localHandled || (error.response && error.response.__localHandled)) {
      const resp = error.response
      return {
        success: resp.__localSuccess !== false && resp.data.code === 200,
        message: resp.data.message,
        data: resp.data.data
      }
    }

    if (error.response) {
      let errorMessage = ERROR_MESSAGES.REQUEST_FAILED
      switch (error.response.status) {
        case HTTP_STATUS.UNAUTHORIZED:
          console.log('检测到401错误，开始处理未授权访问')
          const isAdminPage = window.location.pathname.startsWith('/admin')
          const isAdminRequest = error.config?.url?.includes('/auth/admin/')
          if (isAdminPage || isAdminRequest) {
            const adminToken = localStorage.getItem('admin_token')
            if (adminToken) {
              console.log('管理员会话过期，清除本地存储')
              localStorage.removeItem('admin_token')
              localStorage.removeItem('admin_refresh_token')
              localStorage.removeItem('admin_info')
              if (!window.location.pathname.includes('/admin/login')) {
                window.location.href = '/admin/login'
              }
              errorMessage = ERROR_MESSAGES.SESSION_EXPIRED
            } else {
              errorMessage = ERROR_MESSAGES.UNAUTHORIZED
            }
          } else {
            const userToken = localStorage.getItem('token')
            if (userToken) {
              console.log('普通用户会话过期，清除本地存储')
              localStorage.removeItem('token')
              localStorage.removeItem('refreshToken')
              localStorage.removeItem('userInfo')
              localStorage.removeItem('fufu_local_mode')
              localStorage.removeItem('fufu_local_current_user')
              window.location.href = '/'
              errorMessage = ERROR_MESSAGES.SESSION_EXPIRED
            } else {
              errorMessage = ERROR_MESSAGES.UNAUTHORIZED
            }
          }
          break
        case HTTP_STATUS.TOO_MANY_REQUESTS:
          errorMessage = ERROR_MESSAGES.TOO_MANY_REQUESTS
          try {
            messageManager.warning(errorMessage)
          } catch (e) {
            console.warn('Failed to show rate limit toast:', e)
          }
          break
        case HTTP_STATUS.FORBIDDEN:
          errorMessage = ERROR_MESSAGES.FORBIDDEN
          break
        case HTTP_STATUS.NOT_FOUND:
          errorMessage = ERROR_MESSAGES.NOT_FOUND
          break
        case HTTP_STATUS.INTERNAL_SERVER_ERROR:
          errorMessage = ERROR_MESSAGES.INTERNAL_SERVER_ERROR
          console.error('服务器内部错误:', error.response.data)
          break
        default:
          errorMessage = error.response.data?.message || `请求失败 (${error.response.status})`
      }
      if (error.response.data && error.response.data.hasOwnProperty('code')) {
        return {
          success: false,
          message: error.response.data.message || errorMessage,
          data: error.response.data.data
        }
      }
      return {
        success: false,
        message: errorMessage,
        data: null
      }
    } else if (error.request) {
      console.error('网络连接失败，请检查网络设置')
      return {
        success: false,
        message: ERROR_MESSAGES.NETWORK_ERROR,
        data: null
      }
    } else {
      console.error('请求配置错误:', error.message)
      return {
        success: false,
        message: error.message || ERROR_MESSAGES.REQUEST_CONFIG_ERROR,
        data: null
      }
    }
  }
)

// 响应后处理：合并本地数据到服务器响应
export function postProcessResponse(url, response, params = {}) {
  if (!isLocalMode() || !response || !response.success) return response

  if ((url === '/posts' || url.startsWith('/posts?')) && response.data?.posts) {
    const serverPosts = response.data.posts
    const user = db.getCurrentLocalUser()
    let localPosts = []
    if (user) {
      localPosts = db.getLocalPosts().filter(p => p.status === 0)
      // 按分类过滤
      if (params?.category_id) {
        localPosts = localPosts.filter(p => p.category_id === params.category_id)
      }
      // 按类型过滤
      if (params?.type !== undefined && params?.type !== null) {
        localPosts = localPosts.filter(p => p.type === params.type)
      }
    }
    const localLikes = user ? db.getLocalLikes().filter(l => l.user_id === user.id) : []
    const localCollections = user ? db.getLocalCollections().filter(c => c.user_id === user.id) : []

    // 合并本地帖子到列表前面
    const merged = [...localPosts, ...serverPosts]

    // 应用本地点赞/收藏状态
    response.data.posts = merged.map(post => {
      const liked = localLikes.some(l => l.target_type === 1 && l.target_id === post.id)
      const collected = localCollections.some(c => c.post_id === post.id)
      return { ...post, liked: post.liked || liked, collected: post.collected || collected }
    })

    if (response.data.pagination) {
      response.data.pagination.total = (response.data.pagination.total || 0) + localPosts.length
    }
  }

  const detailMatch = url.match(/^\/posts\/(\d+)$/)
  if (detailMatch && response.data) {
    const postId = Number(detailMatch[1])
    if (response.data.comments) {
      response.data.comments = mergeLocalComments(postId, response.data.comments)
    }
  }

  const commentMatch = url.match(/^\/posts\/(\d+)\/comments$/)
  if (commentMatch && response.data?.comments) {
    const postId = Number(commentMatch[1])
    response.data.comments = mergeLocalComments(postId, response.data.comments)
  }

  return response
}

export default request
