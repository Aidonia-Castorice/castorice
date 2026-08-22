<script setup>
import { useRouter } from 'vue-router'
import DropdownItem from '@/components/menu/DropdownItem.vue'
import DropdownDivider from '@/components/menu/DropdownDivider.vue'
import ThemeSwitcherMenuItem from '@/components/menu/ThemeSwitcherMenuItem.vue'
import { useUserStore } from '@/stores/user'
import { useAuthStore } from '@/stores/auth'
import { useAboutStore } from '@/stores/about'
import { useKeyboardShortcutsStore } from '@/stores/keyboardShortcuts'
import { useAccountSecurityStore } from '@/stores/accountSecurity'
import ColorPickerMenuItem from '@/components/menu/ColorPickerMenuItem.vue'
const router = useRouter()
const userStore = useUserStore()
const authStore = useAuthStore()
const aboutStore = useAboutStore()
const keyboardShortcutsStore = useKeyboardShortcutsStore()
const accountSecurityStore = useAccountSecurityStore()
// 登录处理
const handleLoginClick = () => {
  authStore.openLoginModal()
}
// 退出登录处理
const handleLogout = async () => {
  try {
    await userStore.logout()
    window.location.reload()
  } catch (error) {
    console.error('退出登录失败:', error)
  }
}
// 菜单项点击处理
const handleMenuClick = (action) => {
  if (action === 'about') {
    aboutStore.openAboutModal()
  } else if (action === 'logout') {
    handleLogout()
  } else if (action === 'login') {
    handleLoginClick()
  } else if (action === 'accountSecurity') {
    accountSecurityStore.openAccountSecurityModal()
  } else if (action === 'keyboardShortcuts') {
    keyboardShortcutsStore.openKeyboardShortcutsModal()
  } else if (action === 'admin') {
    router.push('/admin/users')
  }
}
</script>
<template>
  <DropdownItem @click="handleMenuClick('about')">
    关于小蝶书
  </DropdownItem>
  <DropdownItem @click="handleMenuClick('keyboardShortcuts')">
    键盘快捷键
  </DropdownItem>
  <DropdownItem v-if="userStore.isLoggedIn" @click="handleMenuClick('accountSecurity')">
    账号与安全
  </DropdownItem>
  <DropdownItem v-if="userStore.isSiteOwner" @click="handleMenuClick('admin')">
    管理后台
  </DropdownItem>
  <DropdownDivider />
  <ColorPickerMenuItem />
  <ThemeSwitcherMenuItem />
  <DropdownItem v-if="userStore.isLoggedIn" @click="handleMenuClick('logout')">
    退出登录
  </DropdownItem>
  <DropdownItem v-else @click="handleMenuClick('login')">
    登录/注册
  </DropdownItem>
</template>
