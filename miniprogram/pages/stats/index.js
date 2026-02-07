const STORAGE_CHECKINS = "study_checkins";
const COLLECTION_CHECKINS = "checkins";
const BATCH_LIMIT = 50;

function getWeekStart(date) {
  const day = date.getDay();
  const diff = (day + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function buildDailyMap(records) {
  const daily = {};
  records.forEach((item) => {
    if (!daily[item.date]) {
      daily[item.date] = { minutes: 0, checked: false };
    }
    daily[item.date].minutes += item.minutes || 0;
    if (item.checked) {
      daily[item.date].checked = true;
    }
  });
  return daily;
}

function isCloudReady() {
  const app = getApp();
  return !!(wx.cloud && app?.globalData?.env);
}

async function fetchAll(collection) {
  let all = [];
  let skip = 0;
  while (true) {
    const res = await collection.skip(skip).limit(BATCH_LIMIT).get();
    all = all.concat(res.data);
    if (res.data.length < BATCH_LIMIT) {
      break;
    }
    skip += BATCH_LIMIT;
  }
  return all;
}

Page({
  data: {
    totalMinutes: 0,
    totalCheckins: 0,
    weekMinutes: 0,
    weekDays: 0,
  },

  async onShow() {
    try {
      if (isCloudReady()) {
        await this.loadCloud();
        return;
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: "云数据加载失败", icon: "none" });
    }
    this.loadLocal();
  },

  loadLocal() {
    const records = wx.getStorageSync(STORAGE_CHECKINS) || [];
    this.calculateStats(records);
  },

  async loadCloud() {
    const db = wx.cloud.database();
    const records = await fetchAll(db.collection(COLLECTION_CHECKINS));
    this.calculateStats(records);
  },

  calculateStats(records) {
    const dailyMap = buildDailyMap(records);
    const dailyKeys = Object.keys(dailyMap);

    let totalMinutes = 0;
    let totalCheckins = 0;
    dailyKeys.forEach((key) => {
      totalMinutes += dailyMap[key].minutes;
      if (dailyMap[key].checked) {
        totalCheckins += 1;
      }
    });

    const weekStart = getWeekStart(new Date());
    let weekMinutes = 0;
    let weekDays = 0;
    dailyKeys.forEach((key) => {
      const date = new Date(`${key}T00:00:00`);
      if (date >= weekStart) {
        weekMinutes += dailyMap[key].minutes;
        if (dailyMap[key].checked) {
          weekDays += 1;
        }
      }
    });

    this.setData({
      totalMinutes,
      totalCheckins,
      weekMinutes,
      weekDays,
    });
  },
});
