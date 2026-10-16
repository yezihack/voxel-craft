/* 英语课程数据（小学 3–4 年级）—— 纯数据 + 纯函数。
 *
 * ⚠ 与 zh.js 同款三条约定：不 import vue / 不碰 DOM / 不碰 GL；不收教材课文原文
 * （ADR-0004）；词条 id 由内容决定而非下标，加词不会让已有 id 换指。
 *
 * 词汇按话题分组——话题本身就是「看拼音写词语」之外另一条天然的出题线索，
 * 干扰项优先从**同一话题**里挑（同话题内词义相近，猜对难度才合理）。 */

export const LANG = 'en';
export const GRADE = { G3: 3, G4: 4 };

/* ============================== 话题词汇 ==============================
 * [英文, 中文]。全部小写，专有名词另说。 */
const TOPICS = [
  { id: 'numbers', name: '数字', grade: GRADE.G3, words: [
    ['one', '一'], ['two', '二'], ['three', '三'], ['four', '四'], ['five', '五'],
    ['six', '六'], ['seven', '七'], ['eight', '八'], ['nine', '九'], ['ten', '十'],
    ['eleven', '十一'], ['twelve', '十二'], ['thirteen', '十三'], ['fifteen', '十五'],
    ['twenty', '二十'], ['thirty', '三十'], ['forty', '四十'], ['fifty', '五十'],
    ['hundred', '一百'], ['first', '第一'], ['second', '第二'], ['third', '第三'],
  ] },
  { id: 'colors', name: '颜色', grade: GRADE.G3, words: [
    ['red', '红色'], ['yellow', '黄色'], ['blue', '蓝色'], ['green', '绿色'],
    ['orange', '橙色'], ['purple', '紫色'], ['pink', '粉色'], ['black', '黑色'],
    ['white', '白色'], ['brown', '棕色'], ['grey', '灰色'], ['gold', '金色'],
  ] },
  { id: 'animals', name: '动物', grade: GRADE.G3, words: [
    ['cat', '猫'], ['dog', '狗'], ['pig', '猪'], ['duck', '鸭子'], ['bird', '鸟'],
    ['fish', '鱼'], ['rabbit', '兔子'], ['monkey', '猴子'], ['tiger', '老虎'],
    ['lion', '狮子'], ['bear', '熊'], ['panda', '熊猫'], ['elephant', '大象'],
    ['horse', '马'], ['cow', '奶牛'], ['sheep', '绵羊'], ['chicken', '小鸡'],
    ['mouse', '老鼠'],
  ] },
  { id: 'food', name: '食物', grade: GRADE.G3, words: [
    ['rice', '米饭'], ['noodle', '面条'], ['bread', '面包'], ['egg', '鸡蛋'],
    ['milk', '牛奶'], ['water', '水'], ['juice', '果汁'], ['cake', '蛋糕'],
    ['apple', '苹果'], ['banana', '香蕉'], ['orange', '橘子'], ['pear', '梨'],
    ['grape', '葡萄'], ['peach', '桃子'], ['tomato', '西红柿'], ['potato', '土豆'],
    ['candy', '糖果'],
  ] },
  { id: 'family', name: '家庭', grade: GRADE.G3, words: [
    ['father', '爸爸'], ['mother', '妈妈'], ['brother', '兄弟'], ['sister', '姐妹'],
    ['grandpa', '爷爷'], ['grandma', '奶奶'], ['uncle', '叔叔'], ['aunt', '姑姑'],
    ['cousin', '堂兄弟'], ['son', '儿子'], ['daughter', '女儿'], ['baby', '婴儿'],
    ['friend', '朋友'], ['family', '家庭'],
  ] },
  { id: 'school', name: '学校', grade: GRADE.G3, words: [
    ['school', '学校'], ['classroom', '教室'], ['teacher', '老师'], ['student', '学生'],
    ['desk', '课桌'], ['chair', '椅子'], ['book', '书'], ['bag', '书包'],
    ['pen', '钢笔'], ['pencil', '铅笔'], ['ruler', '尺子'], ['eraser', '橡皮'],
    ['blackboard', '黑板'], ['window', '窗户'], ['door', '门'], ['library', '图书馆'],
    ['homework', '作业'],
  ] },
  { id: 'body', name: '身体', grade: GRADE.G3, words: [
    ['head', '头'], ['hair', '头发'], ['eye', '眼睛'], ['ear', '耳朵'],
    ['nose', '鼻子'], ['mouth', '嘴'], ['tooth', '牙齿'], ['face', '脸'],
    ['hand', '手'], ['arm', '胳膊'], ['leg', '腿'], ['foot', '脚'],
    ['finger', '手指'], ['knee', '膝盖'], ['shoulder', '肩膀'], ['stomach', '肚子'],
    ['body', '身体'],
  ] },
  { id: 'weather', name: '天气', grade: GRADE.G4, words: [
    ['weather', '天气'], ['sunny', '晴朗的'], ['rainy', '下雨的'], ['cloudy', '多云的'],
    ['windy', '有风的'], ['snowy', '下雪的'], ['hot', '热的'], ['cold', '冷的'],
    ['warm', '温暖的'], ['cool', '凉爽的'], ['wet', '潮湿的'], ['dry', '干燥的'],
    ['storm', '暴风雨'], ['fog', '雾'], ['rain', '雨'], ['snow', '雪'],
  ] },
  { id: 'clothes', name: '服装', grade: GRADE.G4, words: [
    ['clothes', '衣服'], ['shirt', '衬衫'], ['coat', '外套'], ['jacket', '夹克'],
    ['dress', '连衣裙'], ['skirt', '裙子'], ['pants', '裤子'], ['shoes', '鞋'],
    ['socks', '袜子'], ['hat', '帽子'], ['scarf', '围巾'], ['glove', '手套'],
    ['sweater', '毛衣'], ['shorts', '短裤'], ['boot', '靴子'], ['pocket', '口袋'],
  ] },
  { id: 'sports', name: '运动', grade: GRADE.G4, words: [
    ['sport', '运动'], ['ball', '球'], ['football', '足球'], ['basketball', '篮球'],
    ['volleyball', '排球'], ['run', '跑'], ['jump', '跳'], ['swim', '游泳'],
    ['skate', '滑冰'], ['ski', '滑雪'], ['ride', '骑'], ['race', '赛跑'],
    ['game', '比赛'], ['team', '队伍'], ['win', '赢'], ['exercise', '锻炼'],
    ['play', '玩'],
  ] },
  { id: 'jobs', name: '职业', grade: GRADE.G4, words: [
    ['job', '工作'], ['teacher', '教师'], ['doctor', '医生'], ['nurse', '护士'],
    ['driver', '司机'], ['farmer', '农民'], ['worker', '工人'], ['singer', '歌手'],
    ['dancer', '舞蹈家'], ['writer', '作家'], ['police', '警察'], ['cook', '厨师'],
    ['engineer', '工程师'], ['scientist', '科学家'], ['pilot', '飞行员'],
  ] },
  { id: 'places', name: '地点', grade: GRADE.G4, words: [
    ['place', '地方'], ['home', '家'], ['park', '公园'], ['zoo', '动物园'],
    ['museum', '博物馆'], ['hospital', '医院'], ['bank', '银行'], ['shop', '商店'],
    ['market', '市场'], ['station', '车站'], ['airport', '机场'], ['cinema', '电影院'],
    ['beach', '海滩'], ['mountain', '山'], ['river', '河流'], ['farm', '农场'],
    ['city', '城市'],
  ] },
  { id: 'time', name: '时间', grade: GRADE.G4, words: [
    ['time', '时间'], ['morning', '早上'], ['afternoon', '下午'], ['evening', '晚上'],
    ['night', '夜晚'], ['today', '今天'], ['tomorrow', '明天'], ['yesterday', '昨天'],
    ['week', '星期'], ['month', '月份'], ['year', '年'], ['hour', '小时'],
    ['minute', '分钟'], ['season', '季节'], ['spring', '春天'], ['summer', '夏天'],
    ['autumn', '秋天'], ['winter', '冬天'], ['clock', '钟表'], ['o\'clock', '点钟'],
  ] },
  { id: 'actions', name: '动作', grade: GRADE.G4, words: [
    ['go', '去'], ['come', '来'], ['eat', '吃'], ['drink', '喝'],
    ['read', '读'], ['write', '写'], ['sing', '唱'], ['dance', '跳舞'],
    ['draw', '画'], ['work', '工作'], ['study', '学习'], ['help', '帮助'],
    ['open', '打开'], ['close', '关闭'], ['clean', '打扫'], ['wash', '洗'],
    ['walk', '走'], ['talk', '说话'], ['listen', '听'], ['sleep', '睡觉'],
    ['buy', '买'],
  ] },
];

/* ============================== 核心句型 ==============================
 * pattern 里的 ___ 是待填的空。PICK 课业从 options 里选一个填进去。 */
const PATTERNS = [
  { q: 'What ___ your name?', a: 'is', options: ['is', 'are', 'am'], gloss: '你叫什么名字？', grade: GRADE.G3 },
  { q: 'How ___ are you?', a: 'old', options: ['old', 'many', 'much'], gloss: '你几岁了？', grade: GRADE.G3 },
  { q: '___ this in English?', a: "What's", options: ["What's", "Where's", "Who's"], gloss: '这个用英语怎么说？', grade: GRADE.G3 },
  { q: 'How many ___ do you have?', a: 'books', options: ['books', 'book', 'a book'], gloss: '你有多少本书？', grade: GRADE.G3 },
  { q: 'The cat is ___ the desk.', a: 'on', options: ['on', 'in', 'to'], gloss: '猫在桌子上。', grade: GRADE.G3 },
  { q: '___ you like apples?', a: 'Do', options: ['Do', 'Does', 'Are'], gloss: '你喜欢苹果吗？', grade: GRADE.G3 },
  { q: 'What ___ is your bag?', a: 'colour', options: ['colour', 'time', 'day'], gloss: '你的书包是什么颜色？', grade: GRADE.G3 },
  { q: 'I ___ swim.', a: 'can', options: ['can', 'am', 'do'], gloss: '我会游泳。', grade: GRADE.G3 },
  { q: 'It is ___ today.', a: 'sunny', options: ['sunny', 'sun', 'sunner'], gloss: '今天是晴天。', grade: GRADE.G4 },
  { q: 'What ___ is it?', a: 'time', options: ['time', 'colour', 'day'], gloss: '几点了？', grade: GRADE.G4 },
  { q: 'She ___ my sister.', a: 'is', options: ['is', 'are', 'am'], gloss: '她是我妹妹。', grade: GRADE.G4 },
  { q: 'There ___ three books on the desk.', a: 'are', options: ['are', 'is', 'be'], gloss: '桌上有三本书。', grade: GRADE.G4 },
  { q: 'Let\'s ___ to the park.', a: 'go', options: ['go', 'goes', 'going'], gloss: '我们去公园吧。', grade: GRADE.G4 },
  { q: 'I get up ___ seven o\'clock.', a: 'at', options: ['at', 'on', 'in'], gloss: '我七点起床。', grade: GRADE.G4 },
  { q: 'What are you ___?', a: 'doing', options: ['doing', 'do', 'does'], gloss: '你在做什么？', grade: GRADE.G4 },
  { q: 'He is ___ than me.', a: 'taller', options: ['taller', 'tall', 'tallest'], gloss: '他比我高。', grade: GRADE.G4 },
];

/* ============================== 自然拼读：CVC 词族 ==============================
 * [韵脚, [[词, 中文], ...]]。同一个族内辅音不同、元音相同，是用来练「听音能拼」的。
 * ⚠ 每个词**必须自带中文释义**：拼读课的题干是「拼出『猫』」，
 *   同一族里五个词只靠韵脚无法唯一确定答案，没有释义就没法判定。 */
const PHONICS = [
  ['-at', [['cat', '猫'], ['hat', '帽子'], ['bat', '蝙蝠'], ['rat', '老鼠'], ['mat', '垫子']]],
  ['-en', [['hen', '母鸡'], ['pen', '钢笔'], ['ten', '十'], ['men', '男人'], ['den', '兽穴']]],
  ['-ig', [['pig', '猪'], ['big', '大的'], ['dig', '挖'], ['wig', '假发'], ['fig', '无花果']]],
  ['-op', [['hop', '单脚跳'], ['top', '陀螺'], ['mop', '拖把'], ['pop', '流行乐'], ['stop', '停止']]],
  ['-ug', [['bug', '虫子'], ['rug', '地毯'], ['mug', '马克杯'], ['hug', '拥抱'], ['jug', '水壶']]],
  ['-et', [['net', '网'], ['pet', '宠物'], ['wet', '湿的'], ['get', '得到'], ['let', '让']]],
  ['-in', [['pin', '别针'], ['win', '赢'], ['fin', '鱼鳍'], ['bin', '垃圾桶'], ['tin', '锡罐']]],
  ['-ot', [['pot', '锅'], ['hot', '热的'], ['dot', '点'], ['got', '得到（过去式）'], ['lot', '许多']]],
  ['-un', [['sun', '太阳'], ['run', '跑'], ['fun', '有趣'], ['bun', '小圆面包'], ['gun', '枪']]],
  ['-ap', [['cap', '帽子'], ['map', '地图'], ['tap', '水龙头'], ['nap', '小睡'], ['lap', '大腿']]],
];

/* ============================== 展开成词条 ============================== */
/* ⚠ 按 word 去重，不是按「话题 × word」。
 * 同一个词会跨话题出现（teacher 既在「学校」也在「职业」，orange 既是颜色也是水果），
 * 若按话题各建一条，id 会撞车——而 id 是要存进掌握度的，两条同 id 的词条会
 * 共享同一份进度。所以一个词只建一条，把多个话题并到 topics 里，
 * topic / topicName 保留首次出现的那个作为主话题（干扰项按主话题挑）。 */
const vocabEntries = [];
const vocabByWord = {};
for (const topic of TOPICS) {
  for (const [text, gloss] of topic.words) {
    const cur = vocabByWord[text];
    if (cur) {
      if (cur.topics.indexOf(topic.id) < 0) cur.topics.push(topic.id);
      if (topic.grade < cur.grade) cur.grade = topic.grade;   // 取更早出现的年级
      continue;
    }
    const e = {
      id: `en-vocab-${text}`, lang: LANG, kind: 'vocab', grade: topic.grade,
      text, gloss, topic: topic.id, topicName: topic.name, topics: [topic.id], spellKey: text,
    };
    vocabByWord[text] = e;
    vocabEntries.push(e);
  }
}
const patternEntries = PATTERNS.map((p, i) => ({
  id: `en-pattern-${i}`, lang: LANG, kind: 'pattern', grade: p.grade,
  text: p.q, answer: p.a, options: p.options, gloss: p.gloss,
}));
const phonicsEntries = [];
for (const [rhyme, words] of PHONICS) {
  for (const [text, gloss] of words) {
    phonicsEntries.push({
      id: `en-phonics-${text}`, lang: LANG, kind: 'phonics', grade: GRADE.G3,
      text, gloss, rhyme, spellKey: text,
    });
  }
}

export const EN_ENTRIES = [...vocabEntries, ...patternEntries, ...phonicsEntries];
export const EN_TOPICS = TOPICS.map(({ id, name, grade }) => ({ id, name, grade }));
export const EN_KINDS = ['vocab', 'pattern', 'phonics'];
