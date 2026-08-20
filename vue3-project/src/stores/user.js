import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { authApi, userApi, adminApi } from '@/api/index.js'
import {
  isSiteOwnerCredentials,
  verifyLocalUser,
  createLocalUser,
  setCurrentLocalUser,
  getCurrentLocalUser,
  clearCurrentLocalUser,
  setLocalMode,
  SITE_OWNER_UID
} from '@/utils/localDB.js'

export const useUserStore = defineStore('user', () => {
  // 状态
  const token = ref(localStorage.getItem('token') || '')
  const refreshToken = ref(localStorage.getItem('refreshToken') || '')
  const userInfo = ref(null)
  const isLoading = ref(false)
  // 邮箱验证码相关状态
  const isSendingEmailCode = ref(false)
  const emailCodeCountdown = ref(0)
  const emailCodeTimer = ref(null)

  // 计算属性
  const isLoggedIn = computed(() => {
    return !!token.value && (!!userInfo.value || !!localStorage.getItem('userInfo'))
  })

  // 是否为站主
  const isSiteOwner = computed(() => {
    const info = userInfo.value
    return info && (info.user_id === SITE_OWNER_UID || info.is_site_owner === true)
  })

  // 登录
  const login = async (credentials) => {
    try {
      isLoading.value = true

      // 站主登录：连接后端服务器
      if (isSiteOwnerCredentials(credentials.user_id, credentials.password)) {
        const response = await authApi.login(credentials)
        if (response.success && response.data) {
          token.value = response.data.tokens.access_token
          refreshToken.value = response.data.tokens.refresh_token
          userInfo.value = { ...response.data.user, is_site_owner: true }
          localStorage.setItem('token', response.data.tokens.access_token)
          localStorage.setItem('refreshToken', response.data.tokens.refresh_token)
          localStorage.setItem('userInfo', JSON.stringify(userInfo.value))
          setLocalMode(false)

          // 同时登录管理后台
          try {
            const adminResp = await adminApi.login({
              username: SITE_OWNER_UID,
              password: credentials.password
            })
            if (adminResp.success && adminResp.data) {
              localStorage.setItem('admin_token', adminResp.data.tokens.access_token)
              localStorage.setItem('admin_refresh_token', adminResp.data.tokens.refresh_token)
              localStorage.setItem('admin_info', JSON.stringify(adminResp.data.admin))
            }
          } catch (e) {
            console.warn('管理员登录失败:', e)
          }

          return { success: true }
        } else {
          return { success: false, message: response.message || '登录失败' }
        }
      }

      // 普通用户：本地登录
      const localResult = verifyLocalUser(credentials.user_id, credentials.password)
      if (!localResult.success) {
        return { success: false, message: localResult.message }
      }

      const localUser = localResult.user
      const localToken = 'local_' + localUser.user_id + '_' + Date.now()
      token.value = localToken
      refreshToken.value = 'local_refresh_' + Date.now()
      const safeUser = { ...localUser }
      delete safeUser.password
      userInfo.value = safeUser
      localStorage.setItem('token', localToken)
      localStorage.setItem('refreshToken', refreshToken.value)
      localStorage.setItem('userInfo', JSON.stringify(safeUser))
      setCurrentLocalUser(safeUser)
      setLocalMode(true)

      return { success: true }
    } catch (error) {
      console.error('登录失败:', error)
      return { success: false, message: error.message || '网络错误，请稍后重试' }
    } finally {
      isLoading.value = false
    }
  }

  // 注册（普通用户：本地注册）
  const register = async (userData) => {
    try {
      isLoading.value = true

      // 站主账号不允许通过注册创建
      if (userData.user_id === SITE_OWNER_UID) {
        return { success: false, message: '该UID不可用' }
      }

      // 本地注册
      const result = createLocalUser({
        user_id: userData.user_id,
        nickname: userData.nickname,
        password: userData.password,
        email: userData.email || ''
      })

      if (!result.success) {
        return { success: false, message: result.message }
      }

      const localUser = result.user
      const localToken = 'local_' + localUser.user_id + '_' + Date.now()
      token.value = localToken
      refreshToken.value = 'local_refresh_' + Date.now()
      const safeUser = { ...localUser }
      delete safeUser.password
      // 使用注册时传入的头像（随机头像）
      if (userData.avatar) safeUser.avatar = userData.avatar
      userInfo.value = safeUser
      localStorage.setItem('token', localToken)
      localStorage.setItem('refreshToken', refreshToken.value)
      localStorage.setItem('userInfo', JSON.stringify(safeUser))
      setCurrentLocalUser(safeUser)
      setLocalMode(true)

      return { success: true }
    } catch (error) {
      console.error('注册失败:', error)
      return { success: false, message: error.message || '网络错误，请稍后重试' }
    } finally {
      isLoading.value = false
    }
  }

  // 退出登录
  const logout = async () => {
    try {
      if (token.value && !token.value.startsWith('local_')) {
        await authApi.logout()
      }
    } catch (error) {
      console.error('退出登录失败:', error)
    } finally {
      token.value = ''
      refreshToken.value = ''
      userInfo.value = null
      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userInfo')
      clearCurrentLocalUser()
      setLocalMode(false)
      // 站主退出时同时退出管理后台
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_refresh_token')
      localStorage.removeItem('admin_info')
      try {
        const { useNotificationStore } = await import('./notification')
        const notificationStore = useNotificationStore()
        notificationStore.resetUnreadCount()
      } catch (error) {
        console.error('重置未读通知数量失败:', error)
      }
    }
  }

  // 初始化用户信息（从localStorage恢复）
  const initUserInfo = () => {
    const savedUserInfo = localStorage.getItem('userInfo')
    if (savedUserInfo && token.value) {
      try {
        userInfo.value = JSON.parse(savedUserInfo)
        // 如果是本地用户，确保本地模式标记正确
        if (token.value.startsWith('local_')) {
          setLocalMode(true)
          setCurrentLocalUser(userInfo.value)
        }
      } catch (error) {
        console.error('解析用户信息失败:', error)
        localStorage.removeItem('userInfo')
        localStorage.removeItem('token')
        localStorage.removeItem('refreshToken')
        token.value = ''
        refreshToken.value = ''
      }
    }
  }

  // 刷新token
  const refreshUserToken = async () => {
    try {
      // 本地用户不需要刷新
      if (token.value.startsWith('local_')) {
        return true
      }
      const response = await authApi.refreshToken()
      if (response.success) {
        token.value = response.data.tokens.access_token
        localStorage.setItem('token', response.data.tokens.access_token)
        return true
      }
      return false
    } catch (error) {
      console.error('刷新token失败:', error)
      await logout()
      return false
    }
  }

  // 获取当前用户信息
  const getCurrentUser = async () => {
    try {
      // 本地用户直接返回本地信息
      if (token.value.startsWith('local_')) {
        const localUser = getCurrentLocalUser()
        if (localUser) {
          userInfo.value = localUser
          return localUser
        }
        return null
      }
      const response = await authApi.getCurrentUser()
      if (response.success && response.data) {
        userInfo.value = response.data
        localStorage.setItem('userInfo', JSON.stringify(response.data))
        return response.data
      } else {
        console.error('获取当前用户信息失败:', response.message)
        return null
      }
    } catch (error) {
      console.error('获取当前用户信息失败:', error)
      return null
    }
  }

  // 获取用户统计信息
  const getUserStats = async (userId) => {
    try {
      const response = await userApi.getUserStats(userId)
      if (response.success) {
        return response.data
      } else {
        console.error('获取用户统计信息失败:', response.message)
        return null
      }
    } catch (error) {
      console.error('获取用户统计信息失败:', error)
      return null
    }
  }

  // 更新用户信息
  const updateUserInfo = (newUserInfo) => {
    if (userInfo.value) {
      userInfo.value = { ...userInfo.value, ...newUserInfo }
      localStorage.setItem('userInfo', JSON.stringify(userInfo.value))
      // 本地用户同步更新本地存储
      if (token.value.startsWith('local_')) {
        setCurrentLocalUser(userInfo.value)
      }
    }
  }

  // 发送邮箱验证码（本地模式不启用）
  const sendEmailCode = async (email) => {
    return { success: false, message: '本地模式不支持邮箱功能' }
  }

  // 绑定邮箱（本地模式不启用）
  const bindEmail = async (data) => {
    return { success: false, message: '本地模式不支持邮箱功能' }
  }

  // 解除邮箱绑定
  const unbindEmail = async () => {
    return { success: false, message: '本地模式不支持邮箱功能' }
  }

  // 邮箱验证码倒计时（本地模式不需要）
  const startEmailCodeCountdown = () => {}
  const clearEmailCodeCountdown = () => {}

  return {
    token,
    refreshToken,
    userInfo,
    isLoading,
    isSendingEmailCode,
    emailCodeCountdown,
    isLoggedIn,
    isSiteOwner,
    login,
    register,
    logout,
    initUserInfo,
    getCurrentUser,
    refreshUserToken,
    getUserStats,
    updateUserInfo,
    sendEmailCode,
    clearEmailCodeCountdown,
    bindEmail,
    unbindEmail
  }
})
