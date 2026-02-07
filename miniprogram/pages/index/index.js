const STORAGE_GOAL = "study_goal";
const STORAGE_CHECKINS = "study_checkins";
const COLLECTION_GOALS = "goals";
const COLLECTION_CHECKINS = "checkins";
const BATCH_LIMIT = 50;

function getToday() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

function calcStreak(dailyMap, today) {
  let streak = 0;
  let cursor = new Date(`${today}T00:00:00`);
  while (true) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!dailyMap[dateStr] || !dailyMap[dateStr].checked) {
      break;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
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
    goalId: "",
    goalTitle: "学习目标",
    goalDailyMinutes: 60,
    todayMinutes: 0,
    todayChecked: false,
    streakDays: 0,
    timerRunning: false,
    timerSeconds: 0,
    timerDisplay: "00:00",
    cloudReady: false,
  },

  async onLoad() {
    const cloudReady = isCloudReady();
    this.setData({ cloudReady });
    await this.loadData();
  },

  onUnload() {
    this.clearTimer();
  },

  onHide() {
    this.clearTimer();
  },

  async loadData() {
    if (this.data.cloudReady) {
      try {
        await this.loadDataCloud();
        return;
      } catch (err) {
        console.error(err);
        wx.showToast({ title: "云数据加载失败", icon: "none" });
      }
    }
    this.loadDataLocal();
  },

  loadDataLocal() {
    const goal = wx.getStorageSync(STORAGE_GOAL);
    if (goal) {
      this.setData({
        goalTitle: goal.title || "学习目标",
        goalDailyMinutes: Number(goal.dailyMinutes) || 60,
        goalId: "",
      });
    }

    const records = wx.getStorageSync(STORAGE_CHECKINS) || [];
    const today = getToday();
    const dailyMap = buildDailyMap(records);
    const todayRecord = dailyMap[today] || { minutes: 0, checked: false };
    const streak = calcStreak(dailyMap, today);

    this.setData({
      todayMinutes: todayRecord.minutes,
      todayChecked: todayRecord.checked,
      streakDays: streak,
    });
  },

  async loadDataCloud() {
    const db = wx.cloud.database();
    const [goalRes, checkinRecords] = await Promise.all([
      db.collection(COLLECTION_GOALS).orderBy("createdAt", "desc").limit(1).get(),
      fetchAll(db.collection(COLLECTION_CHECKINS)),
    ]);

    const goal = goalRes.data?.[0];
    if (goal) {
      this.setData({
        goalId: goal._id,
        goalTitle: goal.title || "学习目标",
        goalDailyMinutes: Number(goal.dailyMinutes) || 60,
      });
    }

    const today = getToday();
    const dailyMap = buildDailyMap(checkinRecords);
    const todayRecord = dailyMap[today] || { minutes: 0, checked: false };
    const streak = calcStreak(dailyMap, today);

    this.setData({
      todayMinutes: todayRecord.minutes,
      todayChecked: todayRecord.checked,
      streakDays: streak,
    });
  },

  saveRecordsLocal(records) {
    wx.setStorageSync(STORAGE_CHECKINS, records);
    this.loadDataLocal();
  },

  onGoalTitleInput(e) {
    this.setData({ goalTitle: e.detail.value });
  },

  onGoalMinutesInput(e) {
    this.setData({ goalDailyMinutes: Number(e.detail.value) || 0 });
  },

  async saveGoal() {
    if (!this.data.cloudReady) {
      wx.setStorageSync(STORAGE_GOAL, {
        title: this.data.goalTitle,
        dailyMinutes: this.data.goalDailyMinutes,
      });
      wx.showToast({ title: "目标已保存", icon: "success" });
      return;
    }

    const db = wx.cloud.database();
    const now = db.serverDate();
    if (this.data.goalId) {
      await db.collection(COLLECTION_GOALS).doc(this.data.goalId).update({
        data: {
          title: this.data.goalTitle,
          dailyMinutes: this.data.goalDailyMinutes,
          updatedAt: now,
        },
      });
      wx.showToast({ title: "目标已更新", icon: "success" });
      return;
    }

    const res = await db.collection(COLLECTION_GOALS).add({
      data: {
        title: this.data.goalTitle,
        dailyMinutes: this.data.goalDailyMinutes,
        createdAt: now,
        updatedAt: now,
      },
    });
    this.setData({ goalId: res._id });
    wx.showToast({ title: "目标已保存", icon: "success" });
  },

  async addCheckin(minutes, checked) {
    const date = getToday();
    if (!this.data.cloudReady) {
      const records = wx.getStorageSync(STORAGE_CHECKINS) || [];
      records.push({
        date,
        minutes,
        checked,
        createdAt: Date.now(),
      });
      this.saveRecordsLocal(records);
      return;
    }

    const db = wx.cloud.database();
    await db.collection(COLLECTION_CHECKINS).add({
      data: {
        date,
        minutes,
        checked,
        createdAt: db.serverDate(),
        localCreatedAt: Date.now(),
      },
    });
    await this.loadDataCloud();
  },

  async onCheckin() {
    if (this.data.todayChecked) {
      wx.showToast({ title: "今日已打卡", icon: "none" });
      return;
    }
    await this.addCheckin(this.data.todayMinutes, true);
  },

  startTimer() {
    if (this.data.timerRunning) return;
    this.timerId = setInterval(() => {
      const nextSeconds = this.data.timerSeconds + 1;
      this.setData({
        timerSeconds: nextSeconds,
        timerDisplay: formatTime(nextSeconds),
      });
    }, 1000);
    this.setData({ timerRunning: true });
  },

  async stopTimer() {
    if (!this.data.timerRunning) return;
    this.clearTimer();
    const minutes = Math.max(1, Math.round(this.data.timerSeconds / 60));
    await this.addCheckin(minutes, false);
  },

  clearTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.setData({
      timerRunning: false,
      timerSeconds: 0,
      timerDisplay: "00:00",
    });
  },

  goStats() {
    wx.navigateTo({ url: "/pages/stats/index" });
  },
});
