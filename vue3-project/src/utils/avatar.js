// 默认头像工具模块
// 提供5个Q版角色头像作为默认头像资源
import avatar1 from '@/assets/imgs/fufu_avatar_1.jpg'
import avatar2 from '@/assets/imgs/fufu_avatar_2.jpg'
import avatar3 from '@/assets/imgs/fufu_avatar_3.jpg'
import avatar4 from '@/assets/imgs/fufu_avatar_4.jpg'
import avatar5 from '@/assets/imgs/fufu_avatar_5.jpg'

// 所有默认头像列表
export const defaultAvatars = [avatar1, avatar2, avatar3, avatar4, avatar5]

// 主默认头像（用于占位等场景）
export const defaultAvatar = avatar1

// 随机获取一个默认头像
export const getRandomAvatar = () => {
  const index = Math.floor(Math.random() * defaultAvatars.length)
  return defaultAvatars[index]
}

export default defaultAvatars
