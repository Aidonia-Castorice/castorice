/**
 * 启动时数据初始化
 * 1. 确保站主账号和管理员账号存在
 * 2. 确保分类存在
 * 3. 创建 API 虚拟用户（带头像、简介、属地）
 * 4. 如果没有帖子，从 imgLinks 本地资源 + t.alcy.cc API 获取图片，
 *    按多用户、多图、多标签方式灌装示例帖子，使其在首页与正常发帖用户完全一致
 */
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { pool } = config;

const SITE_OWNER_UID = '芙芙不服';
const SITE_OWNER_PASSWORD = '20099yan';
const SITE_OWNER_NICKNAME = '芙芙不服';

// 分类定义
const CATEGORIES = [
  { name: '推荐', category_title: 'recommend' },
  { name: '学习', category_title: 'study' },
  { name: '校园', category_title: 'campus' },
  { name: '情感', category_title: 'emotion' },
  { name: '兴趣', category_title: 'interest' },
  { name: '生活', category_title: 'life' },
  { name: '社交', category_title: 'social' },
  { name: '求助', category_title: 'help' },
  { name: '观点', category_title: 'opinion' },
  { name: '毕业', category_title: 'graduation' },
  { name: '职场', category_title: 'career' }
];

// ========== API 虚拟用户定义 ==========
const BOT_USERS = [
  { nickname: '云鲸漫游',   bio: '热爱生活，记录美好瞬间 ✨',         location: '杭州' },
  { nickname: '芋圆小甜饼', bio: '一个爱笑的女孩子，分享日常小确幸 😊', location: '成都' },
  { nickname: '晚风扑满怀', bio: '摄影爱好者 | 用镜头记录世界 📷',     location: '上海' },
  { nickname: '雾岛听风',   bio: '读书人 | 书中自有黄金屋 📖',        location: '南京' },
  { nickname: '星子打烊了', bio: '旅行达人 | 世界那么大，我想去看看 ✈️', location: '厦门' },
  { nickname: '奶油小方',   bio: '美食探索者 | 吃遍天下美食 🍜',       location: '广州' },
  { nickname: '山月记',     bio: '手工爱好者 | 用双手创造美好 🎨',     location: '苏州' },
  { nickname: '半糖去冰',   bio: '音乐发烧友 | 生活需要BGM 🎵',       location: '武汉' },
  { nickname: '枕星河入梦', bio: '深夜写字人 | 愿文字能治愈你 💫',     location: '西安' },
  { nickname: '树影摇窗',   bio: '植物妈妈 | 和绿植一起成长 🌱',       location: '昆明' },
  { nickname: '汽水冒泡',   bio: '健身小达人 | 自律给我自由 💪',       location: '重庆' },
  { nickname: '贩卖日落',   bio: '插画师 | 用画笔诉说故事 🖌️',        location: '长沙' },
  { nickname: '焦糖玛奇朵', bio: '咖啡控 | 没有咖啡的日子不完整 ☕',   location: '深圳' },
  { nickname: '小桃汽泡',   bio: '学生党 | 爱学习爱生活 📚',          location: '北京' },
  { nickname: '橘色晚霞',   bio: '生活美学家 | 把日子过成诗 🌺',       location: '青岛' }
];

// ========== 分类帖子内容池 ==========
const CATEGORY_POSTS = {
  '学习': [
    { title: '高效学习法分享，让你事半功倍', content: '经过一年的摸索，我终于找到了适合自己的学习方法。今天分享给大家，希望能帮助到正在学习路上奋斗的小伙伴们。记住，方法比努力更重要！', tags: ['学习', '方法', '成长'] },
    { title: '我的学习笔记整理术，超实用！', content: '整理了我这学期的学习笔记和心得体会，从时间规划到知识梳理，每一个环节都有详细的方法介绍。学习不是死记硬背，而是要找到规律和技巧。', tags: ['学习', '笔记', '技巧'] },
    { title: '考研经验分享，一战上岸秘籍', content: '一战上岸的经验分享，从择校到复习的全流程。每个人的基础不同，但只要找对方法并坚持下去，一定可以的！', tags: ['考研', '学习', '经验'] },
    { title: '时间管理技巧，告别拖延症', content: '分享几个我亲测有效的时间管理方法，番茄工作法、四象限法则、时间块规划……找到适合自己的方法，效率真的会翻倍。', tags: ['时间管理', '学习', '自律'] },
    { title: '读书笔记：《被讨厌的勇气》', content: '最近读完了这本书，有些感悟想和大家分享。阿德勒心理学告诉我们，人的烦恼皆源于人际关系，而自由就是被别人讨厌的勇气。', tags: ['读书', '笔记', '成长'] }
  ],
  '校园': [
    { title: '校园里的猫学长', content: '在校园里遇到了一只超可爱的猫咪，忍不住拍了下来。它好像一点都不怕人，就那么悠闲地晒着太阳，太治愈了。', tags: ['校园', '猫咪', '日常'] },
    { title: '宿舍改造大作战，小空间大智慧', content: '宿舍是我们在校园里的小家，虽然空间不大，但花点心思布置一下，住起来真的会舒服很多。分享我的宿舍改造心得。', tags: ['宿舍', '改造', '校园'] },
    { title: '校园春日漫步，樱花飞舞的季节', content: '春暖花开，校园里的樱花都开了，和朋友一起去赏花，心情也跟着好了起来。分享几张随手拍的照片。', tags: ['校园', '春天', '摄影'] },
    { title: '新生入学指南，学长学姐的贴心提醒', content: '又到了开学季，整理了一些新生入学的注意事项和实用建议，希望能帮到即将入学的小伙伴们。', tags: ['新生', '指南', '校园'] },
    { title: '食堂隐藏菜单大公开', content: '在学校食堂吃了两年，发现了一些隐藏的美味。今天就来给大家盘点一下那些不起眼但超好吃的窗口。', tags: ['食堂', '美食', '校园'] }
  ],
  '情感': [
    { title: '深夜emo时刻，写给迷茫的自己', content: '最近总是在深夜时分陷入沉思，想起了很多过往的事情。人生就像一场旅行，有高峰也有低谷，重要的是要学会在每一个阶段都找到属于自己的意义。', tags: ['情感', '心情', '成长'] },
    { title: '那些治愈人心的温暖瞬间', content: '生活中总有一些瞬间能够温暖人心，可能是陌生人的一个微笑，可能是朋友的一句关怀，也可能是家人的一个拥抱。这些小小的温暖，构成了生活的美好。', tags: ['温暖', '治愈', '生活'] },
    { title: '愿你眼中有光，心中有爱', content: '有些话不知道该对谁说，就写在这里吧。愿每个人都能被温柔以待，愿所有的努力都不被辜负。', tags: ['情感', '祝福', '心情'] },
    { title: '孤独是人生的必修课', content: '有时候觉得很孤独，但后来发现孤独也是一种力量。在独处的时光里，我们能够更好地认识自己，倾听内心的声音。', tags: ['孤独', '成长', '思考'] },
    { title: '关于成长，我想说的话', content: '成长是一个痛苦而美好的过程，我们在跌跌撞撞中学会了坚强，在失去中懂得了珍惜。每一次的经历都是成长路上的垫脚石。', tags: ['成长', '感悟', '情感'] }
  ],
  '兴趣': [
    { title: '手工DIY教程，零基础也能学会', content: '最近迷上了手工制作，发现动手创造的过程特别治愈。今天分享一个简单易学的DIY教程，材料都很容易买到，大家可以在家试试看。', tags: ['手工', 'DIY', '教程'] },
    { title: '摄影技巧分享，拍出大片的秘密', content: '摄影让我学会了用不同的角度去看世界，每一次按下快门都是对美好瞬间的定格。分享一些我在摄影路上的心得和技巧。', tags: ['摄影', '技巧', '兴趣'] },
    { title: '音乐推荐清单，治愈你的耳朵', content: '分享最近循环播放的歌单，从流行到古典，从中文到英文，每一首都很好听。音乐真的是治愈心灵的良药。', tags: ['音乐', '推荐', '歌单'] },
    { title: '烘焙小课堂，甜蜜生活从这里开始', content: '周末在家尝试做了蛋糕，第一次做居然成功了！分享一下配方和制作过程，喜欢烘焙的小伙伴可以试试。', tags: ['烘焙', '美食', '教程'] },
    { title: '绘画日常记录，用画笔记录生活', content: '用画笔记录生活中的美好瞬间，是我最喜欢的事情之一。不需要多么高超的技巧，只要用心去观察和感受，每一幅画都是独一无二的。', tags: ['绘画', '日常', '兴趣'] }
  ],
  '生活': [
    { title: '一人食的精致生活，简单也很美', content: '一个人也要好好吃饭。今天做了一顿简单但精致的晚餐，摆盘好看了，吃饭的心情也会变好。分享我的一人食日常。', tags: ['一人食', '生活', '美食'] },
    { title: '旅行vlog分享，世界那么大要去看看', content: '说走就走的旅行，沿途的风景比目的地更让人惊喜。这次去了一个小众的古镇，人少景美，推荐给大家。', tags: ['旅行', '风景', '分享'] },
    { title: '今日穿搭分享，做自己的时尚博主', content: '今天的穿搭记录，简单舒适又好看。基础款搭配小心机，日常出门完全够用。', tags: ['穿搭', '日常', '时尚'] },
    { title: '家居改造日记，打造温馨小窝', content: '家是心灵的港湾，一个温馨舒适的居住环境能够让人感到放松和愉悦。分享一些家居布置的心得，让家变得更有温度。', tags: ['家居', '改造', '生活'] },
    { title: '周末宅家指南，享受慢时光', content: '最近爱上了慢生活的节奏，不再追求忙碌，而是学会享受当下的每一个瞬间。分享一些让周末变得美好的小习惯。', tags: ['周末', '慢生活', '日常'] },
    { title: '春日赏花攻略', content: '春暖花开，和朋友一起去赏花，心情也跟着好了起来。整理了几个赏花的好去处，附上拍照小技巧。', tags: ['春天', '赏花', '摄影'] },
    { title: '美食制作教程，治愈系料理时光', content: '今天尝试做了一道新菜，味道还不错！分享一下做法，厨房小白也能轻松上手。', tags: ['美食', '教程', '生活'] }
  ],
  '社交': [
    { title: '朋友聚会vlog，快乐时光要分享', content: '和朋友们聚在一起的时光总是特别珍贵，那些欢声笑语和温暖的陪伴，是生活中最美好的回忆。', tags: ['朋友', '聚会', '快乐'] },
    { title: '如何维护长久的友谊关系', content: '真正的友谊需要用心经营和维护，不是简单的点赞之交，而是能够在彼此需要的时候给予支持和陪伴的深厚情谊。', tags: ['友谊', '社交', '心得'] },
    { title: '内向者的社交指南，慢热也很棒', content: '每个人都有自己的社交方式，内向的人也有自己的魅力和优势。重要的是要找到适合自己的社交节奏，做真实的自己。', tags: ['内向', '社交', '成长'] }
  ],
  '求助': [
    { title: '求助：大家有什么提高专注力的方法吗', content: '最近学习的时候总是容易分心，效率很低。大家有什么好的方法或建议吗？求分享！', tags: ['求助', '专注力', '学习'] },
    { title: '求推荐好用的笔记APP', content: '试过好几个笔记APP都不太满意，大家平时都用什么做笔记？希望支持多端同步和markdown。', tags: ['求助', 'APP推荐', '工具'] }
  ],
  '观点': [
    { title: '关于内卷现象的一些思考', content: '最近关于内卷的讨论很热烈，我也想分享一下自己的观点。与其盲目跟风竞争，不如找到自己真正热爱的事情并深耕下去。', tags: ['观点', '思考', '内卷'] },
    { title: '理性讨论：如何看待社交媒体焦虑', content: '社交媒体在带来便利的同时，也让很多人产生了焦虑情绪。看到别人光鲜亮丽的生活，难免会和自己比较。但别忘了，你看到的只是别人想让你看到的。', tags: ['观点', '社交', '焦虑'] }
  ],
  '毕业': [
    { title: '毕业倒计时，青春不散场', content: '时间过得真快，转眼间就要毕业了。回想这几年的大学时光，有太多美好的回忆值得珍藏。感谢所有陪伴我走过这段路程的人。', tags: ['毕业', '青春', '回忆'] },
    { title: '学士服写真，定格青春瞬间', content: '拍了毕业照，穿着学士服站在校园里，百感交集。把最美的笑容留在这个最熟悉的地方。', tags: ['毕业', '写真', '校园'] },
    { title: '致亲爱的室友们，友谊长存', content: '在这个特殊的时刻，想对室友们说声谢谢。是你们让我的大学生活如此精彩和充实，未来的日子里也要常联系！', tags: ['毕业', '室友', '友谊'] }
  ],
  '职场': [
    { title: '求职经验分享，从简历到面试全攻略', content: '刚刚结束了一轮求职，想和大家分享一些经验和心得。从简历制作到面试技巧，每一步都有讲究。希望大家都能拿到心仪的offer。', tags: ['求职', '面试', '经验'] },
    { title: '职场新人生存指南，避坑必看', content: '初入职场的这段时间，学到了很多在学校里学不到的东西。分享一些职场新人需要注意的事项，帮助大家少走弯路。', tags: ['职场', '新人', '指南'] },
    { title: '工作感悟：在职场中成长', content: '工作中遇到了很多挑战，也收获了很多成长。每一次的困难都是学习的机会，保持学习的心态，不断提升自己的能力。', tags: ['职场', '成长', '感悟'] }
  ]
};

// ========== 工具函数 ==========

// 从 imgLinks 目录读取链接文件
function loadLinksFromFile(filename) {
  try {
    const filePath = path.join(__dirname, '..', 'imgLinks', filename);
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim().split('\n').map(l => l.trim()).filter(l => l);
  } catch (err) {
    console.warn(`  读取 ${filename} 失败:`, err.message);
    return [];
  }
}

// 加权随机图片数量：1张25%, 2张20%, 3张20%, 4张15%, 5张8%, 6张5%, 7-9张7%
function randomImageCount() {
  const r = Math.random();
  if (r < 0.25) return 1;
  if (r < 0.45) return 2;
  if (r < 0.65) return 3;
  if (r < 0.80) return 4;
  if (r < 0.88) return 5;
  if (r < 0.93) return 6;
  if (r < 0.96) return 7;
  if (r < 0.98) return 8;
  return 9;
}

// 从 t.alcy.cc 获取随机图片（作为本地链接的补充）
async function fetchRandomImages(count = 30) {
  const categories = ['mp', 'moemp', 'pc'];
  const perCategory = Math.ceil(count / categories.length);
  const allLinks = [];
  for (const cat of categories) {
    try {
      const resp = await fetch(`https://t.alcy.cc/json?${cat}=${perCategory}`, {
        redirect: 'follow'
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.links && Array.isArray(data.links)) {
          allLinks.push(...data.links);
        } else if (Array.isArray(data.data)) {
          allLinks.push(...data.data.map(d => d.link));
        } else if (data.data && data.data.link) {
          allLinks.push(data.data.link);
        }
      }
    } catch (err) {
      console.warn(`  获取 t.alcy.cc 分类 ${cat} 图片失败:`, err.message);
    }
  }
  return allLinks;
}

// 打乱数组（Fisher-Yates）
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========== 站主账号 ==========
async function ensureSiteOwner(avatarUrl) {
  const [users] = await pool.execute(
    'SELECT id FROM users WHERE user_id = ?',
    [SITE_OWNER_UID]
  );
  let ownerId;
  if (users.length === 0) {
    const [result] = await pool.execute(
      `INSERT INTO users (user_id, password, nickname, avatar, bio, location, follow_count, fans_count, like_count, is_active, email, verified, gender, zodiac_sign)
       VALUES (?, SHA2(?, 256), ?, ?, '站主账号', '星穹列车', 0, 0, 0, 1, '', 1, '', '')`,
      [SITE_OWNER_UID, SITE_OWNER_PASSWORD, SITE_OWNER_NICKNAME, avatarUrl || '']
    );
    ownerId = result.insertId;
    console.log(`  站主用户已创建: ${SITE_OWNER_UID} (ID: ${ownerId})`);
  } else {
    ownerId = users[0].id;
    await pool.execute(
      'UPDATE users SET password = SHA2(?, 256), is_active = 1, nickname = ?, avatar = COALESCE(NULLIF(?, ""), avatar) WHERE id = ?',
      [SITE_OWNER_PASSWORD, SITE_OWNER_NICKNAME, avatarUrl || '', ownerId.toString()]
    );
    console.log(`  站主用户已存在: ${SITE_OWNER_UID} (ID: ${ownerId})`);
  }
  // 管理员表
  const [admins] = await pool.execute(
    'SELECT id FROM admin WHERE username = ?',
    [SITE_OWNER_UID]
  );
  if (admins.length === 0) {
    await pool.execute(
      'INSERT INTO admin (username, password) VALUES (?, SHA2(?, 256))',
      [SITE_OWNER_UID, SITE_OWNER_PASSWORD]
    );
    console.log(`  站主管理员账号已创建: ${SITE_OWNER_UID}`);
  } else {
    await pool.execute(
      'UPDATE admin SET password = SHA2(?, 256) WHERE username = ?',
      [SITE_OWNER_PASSWORD, SITE_OWNER_UID]
    );
    console.log(`  站主管理员账号已存在`);
  }
  return ownerId;
}

// ========== 分类 ==========
async function ensureCategories() {
  for (const cat of CATEGORIES) {
    await pool.execute(
      'INSERT IGNORE INTO categories (name, category_title) VALUES (?, ?)',
      [cat.name, cat.category_title]
    );
  }
  console.log(`  分类已就绪 (${CATEGORIES.length} 个)`);
}

async function getCategoryMap() {
  const [rows] = await pool.execute('SELECT id, name, category_title FROM categories');
  const map = {};
  rows.forEach(r => { map[r.name] = r.id; });
  return map;
}

// ========== API 虚拟用户 ==========
async function ensureBotUsers(avatarLinks) {
  const botUserIds = [];
  for (let i = 0; i < BOT_USERS.length; i++) {
    const bot = BOT_USERS[i];
    const avatar = avatarLinks[i % avatarLinks.length] || '';
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE user_id = ?',
      [bot.nickname]
    );
    if (existing.length === 0) {
      // 虚拟用户使用随机密码（不可登录），is_active=1 以正常展示和被关注
      const randomPass = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const [result] = await pool.execute(
        `INSERT INTO users (user_id, password, nickname, avatar, bio, location, follow_count, fans_count, like_count, is_active, email, verified)
         VALUES (?, SHA2(?, 256), ?, ?, ?, ?, 0, 0, 0, 1, '', 0)`,
        [bot.nickname, randomPass, bot.nickname, avatar, bot.bio, bot.location]
      );
      botUserIds.push(result.insertId);
    } else {
      // 确保头像和简介已更新
      await pool.execute(
        'UPDATE users SET avatar = COALESCE(NULLIF(?, ""), avatar), bio = ?, location = ?, is_active = 1 WHERE id = ?',
        [avatar, bot.bio, bot.location, existing[0].id.toString()]
      );
      botUserIds.push(existing[0].id);
    }
  }
  console.log(`  API 虚拟用户已就绪 (${botUserIds.length} 个)`);
  return botUserIds;
}

// ========== 灌装示例帖子 ==========
async function seedSamplePosts(ownerId, botUserIds, avatarLinks) {
  const [countResult] = await pool.execute('SELECT COUNT(*) as total FROM posts WHERE status = 0');
  if (countResult[0].total > 0) {
    console.log(`  已有 ${countResult[0].total} 篇帖子，跳过灌装`);
    return;
  }

  // 1. 收集图片：优先使用本地 imgLinks，再补充 t.alcy.cc
  console.log('  加载本地图片资源...');
  let allImages = loadLinksFromFile('post_img_link.txt');
  console.log(`  本地图片链接: ${allImages.length} 张`);

  console.log('  从 t.alcy.cc 获取补充图片...');
  const apiImages = await fetchRandomImages(60);
  console.log(`  API 补充图片: ${apiImages.length} 张`);
  allImages = allImages.concat(apiImages);

  if (allImages.length === 0) {
    console.warn('  未能获取任何图片，跳过帖子灌装');
    return;
  }
  // 打乱图片顺序
  allImages = shuffle(allImages);
  console.log(`  可用图片总计: ${allImages.length} 张`);

  const categoryMap = await getCategoryMap();

  // 2. 组装帖子计划：站主发 5 篇，其余分给虚拟用户
  const allAuthors = [
    { id: ownerId, isOwner: true },
    ...botUserIds.map(id => ({ id, isOwner: false }))
  ];

  // 从内容池生成帖子列表
  const postPlan = [];
  const categories = Object.keys(CATEGORY_POSTS);
  for (const cat of categories) {
    for (const p of CATEGORY_POSTS[cat]) {
      postPlan.push({ ...p, category: cat });
    }
  }
  // 站主专属欢迎帖放在最前面
  postPlan.unshift({
    title: '愿此行，终抵群星',
    content: '欢迎来到芙芙不服的小世界，这里记录生活中的美好瞬间。希望你也能在这里找到属于自己的那片星空。',
    category: '生活',
    tags: ['欢迎', '生活', '美好'],
    isOwnerPost: true
  });

  // 打乱非站主帖子顺序
  const ownerPosts = postPlan.filter(p => p.isOwnerPost);
  const otherPosts = shuffle(postPlan.filter(p => !p.isOwnerPost));

  let imageIndex = 0;
  let totalCreated = 0;

  // 站主帖子
  for (const post of ownerPosts) {
    const created = await createPost(ownerId, post, categoryMap, allImages, () => {
      const idx = imageIndex;
      imageIndex += randomImageCount();
      return idx;
    }, true);
    if (created) totalCreated++;
  }

  // 其他帖子轮询分配给虚拟用户
  for (let i = 0; i < otherPosts.length; i++) {
    const author = allAuthors[1 + (i % botUserIds.length)]; // 跳过站主
    const post = otherPosts[i];
    const created = await createPost(author.id, post, categoryMap, allImages, () => {
      const idx = imageIndex;
      imageIndex += randomImageCount();
      return idx;
    }, false);
    if (created) totalCreated++;
  }

  console.log(`  示例帖子灌装完成 (${totalCreated} 篇)`);
}

async function createPost(userId, post, categoryMap, allImages, getImageStartIndex, isOwner) {
  const categoryId = categoryMap[post.category] || categoryMap['生活'];
  const imgCount = randomImageCount();
  const startIdx = getImageStartIndex();

  const postImages = [];
  for (let j = 0; j < imgCount && (startIdx + j) < allImages.length; j++) {
    postImages.push(allImages[startIdx + j]);
  }
  if (postImages.length === 0) return false;

  // 随机统计数据
  const viewCount = Math.floor(Math.random() * 800) + 20;
  const likeCount = Math.floor(Math.random() * 80);
  const collectCount = Math.floor(Math.random() * 30);
  // 随机创建时间：最近 30 天内，站主帖子稍早
  const hoursAgo = isOwner
    ? 24 * 25 + Math.floor(Math.random() * 48)
    : Math.floor(Math.random() * 24 * 28) + 2;

  try {
    const [result] = await pool.execute(
      `INSERT INTO posts (user_id, title, content, category_id, type, status, view_count, like_count, collect_count, comment_count, created_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, 0, DATE_SUB(NOW(), INTERVAL ? HOUR))`,
      [
        userId.toString(),
        post.title,
        post.content,
        categoryId,
        viewCount,
        likeCount,
        collectCount,
        hoursAgo
      ]
    );
    const postId = result.insertId;

    // 插入图片
    for (const imgUrl of postImages) {
      await pool.execute(
        'INSERT INTO post_images (post_id, image_url) VALUES (?, ?)',
        [postId.toString(), imgUrl]
      );
    }

    // 插入标签
    if (post.tags && post.tags.length > 0) {
      for (const tagName of post.tags) {
        let [tagRows] = await pool.execute('SELECT id FROM tags WHERE name = ?', [tagName]);
        let tagId;
        if (tagRows.length === 0) {
          const [tagResult] = await pool.execute('INSERT INTO tags (name, use_count) VALUES (?, 0)', [tagName]);
          tagId = tagResult.insertId;
        } else {
          tagId = tagRows[0].id;
        }
        await pool.execute(
          'INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          [postId.toString(), tagId.toString()]
        );
        await pool.execute(
          'UPDATE tags SET use_count = use_count + 1 WHERE id = ?',
          [tagId.toString()]
        );
      }
    }

    return true;
  } catch (err) {
    console.error(`  创建帖子失败 [${post.title}]:`, err.message);
    return false;
  }
}

// ========== 主初始化 ==========
async function initializeOnStartup() {
  try {
    console.log('========== 启动数据初始化 ==========');
    // 等待数据库就绪
    let retries = 0;
    while (retries < 10) {
      try {
        await pool.execute('SELECT 1');
        break;
      } catch (err) {
        retries++;
        console.log(`  等待数据库就绪... (${retries}/10)`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // 加载头像资源
    const avatarLinks = loadLinksFromFile('avatar_link.txt');
    console.log(`  头像资源: ${avatarLinks.length} 个`);

    const ownerId = await ensureSiteOwner(avatarLinks[0] || '');
    await ensureCategories();
    const botUserIds = await ensureBotUsers(avatarLinks.slice(1));
    await seedSamplePosts(ownerId, botUserIds, avatarLinks);

    console.log('========== 初始化完成 ==========\n');
  } catch (err) {
    console.error('启动初始化失败:', err);
  }
}

module.exports = { initializeOnStartup };
