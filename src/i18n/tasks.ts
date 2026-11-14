export interface TaskDatePickerStrings {
  kinds: { created: string; done: string; due: string };
  notSet: string;
  today: string; tomorrow: string; nextMonday: string; presets: string;
  clear: string; close: string;
  previousMonth: string; nextMonth: string;
  saveError: string;
  /** Sunday-first. */
  weekdaysShort: readonly string[];
  /** Sunday-first. */
  weekdaysLong: readonly string[];
  /** `month` is 0-based. */
  monthTitle: (year: number, month: number) => string;
  /** `month` is 0-based; `weekday` is 0 = Sunday. */
  dayLabel: (year: number, month: number, day: number, weekday: number) => string;
}
export interface TaskEditorStrings {
  insertTaskCommand: string;
  dateButtons: string;
  /** `value` is a `YYYY-MM-DD` date or the localized "not set" text. */
  dateButtonLabel: (kindLabel: string, value: string) => string;
}
/** Task stream in the card panel: toolbar toggle, task cards, states, and task actions. */
export interface TaskViewStrings {
  /** Label of the cards/tasks toggle; its pressed state shows the active stream. */
  toggle: string;
  searchPlaceholder: string;
  sortFields: { due: string; created: string; done: string; file: string; text: string };
  building: string;
  emptyScope: string;
  emptyFiltered: string;
  /** `text` is the plain task text. */
  checkboxLabel: (text: string) => string;
  /** `value` is the localized date or the "not set" text; `status` is an optional due state. */
  chipLabel: (kindLabel: string, value: string, status?: string) => string;
  dueOverdue: string;
  dueToday: string;
  /** Short chip date. `month` is 0-based. */
  chipDate: (year: number, month: number, day: number, withYear: boolean) => string;
  /** Full date for tooltips. `month` is 0-based. */
  fullDate: (year: number, month: number, day: number) => string;
  openTask: string;
  openFile: (title: string) => string;
  /** Subtask progress: completed of total. */
  subtaskProgress: (completed: number, total: number) => string;
  saving: string;
  menu: { open: string; openInNewTab: string; copyText: string };
  copied: string;
  copyFailed: string;
  errors: { lineNotFound: string; missingFile: string; notATask: string; writeFailed: string };
}
export interface TaskStrings {
  datePicker: TaskDatePickerStrings;
  editor: TaskEditorStrings;
  view: TaskViewStrings;
}

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ZH_WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export const taskStrings: Record<"en" | "zh", TaskStrings> = {
  en: {
    datePicker: {
      kinds: { created: "Created date", done: "Completed date", due: "Due date" },
      notSet: "Not set",
      today: "Today", tomorrow: "Tomorrow", nextMonday: "Next Monday", presets: "Quick dates",
      clear: "Clear", close: "Close",
      previousMonth: "Previous month", nextMonth: "Next month",
      saveError: "Could not save the date. Try again.",
      weekdaysShort: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
      weekdaysLong: EN_WEEKDAYS,
      monthTitle: (year, month) => `${EN_MONTHS[month]} ${year}`,
      dayLabel: (year, month, day, weekday) => `${EN_WEEKDAYS[weekday]}, ${EN_MONTHS[month]} ${day}, ${year}`,
    },
    editor: {
      insertTaskCommand: "Insert task or convert lines to tasks",
      dateButtons: "Task dates",
      dateButtonLabel: (kindLabel, value) => `${kindLabel}: ${value}`,
    },
    view: {
      toggle: "Task view",
      searchPlaceholder: "Filter tasks",
      sortFields: { due: "Due date", created: "Created date", done: "Completed date", file: "File", text: "Task text" },
      building: "Reading tasks...",
      emptyScope: "No tasks here yet.",
      emptyFiltered: "No tasks match the current search or filters.",
      checkboxLabel: (text) => `Complete \u201c${text}\u201d`,
      chipLabel: (kindLabel, value, status) => `${kindLabel}: ${value}${status ? ` (${status})` : ""}`,
      dueOverdue: "overdue",
      dueToday: "due today",
      chipDate: (year, month, day, withYear) => `${EN_MONTHS_SHORT[month]} ${day}${withYear ? `, ${year}` : ""}`,
      fullDate: (year, month, day) => `${EN_MONTHS[month]} ${day}, ${year}`,
      openTask: "Open task in note",
      openFile: (title) => `Open \u201c${title}\u201d`,
      subtaskProgress: (completed, total) => `${completed} of ${total} subtasks complete`,
      saving: "Saving...",
      menu: { open: "Open task", openInNewTab: "Open task in new tab", copyText: "Copy task text" },
      copied: "Task text copied.",
      copyFailed: "Could not copy the task text.",
      errors: {
        lineNotFound: "This task changed in the note. The list is refreshing.",
        missingFile: "The note for this task no longer exists.",
        notATask: "This line is no longer a task.",
        writeFailed: "Could not update the task.",
      },
    },
  },
  zh: {
    datePicker: {
      kinds: { created: "创建日期", done: "完成日期", due: "截止日期" },
      notSet: "未设置",
      today: "今天", tomorrow: "明天", nextMonday: "下周一", presets: "快捷日期",
      clear: "清除", close: "关闭",
      previousMonth: "上个月", nextMonth: "下个月",
      saveError: "日期保存失败，请重试。",
      weekdaysShort: ["日", "一", "二", "三", "四", "五", "六"],
      weekdaysLong: ZH_WEEKDAYS,
      monthTitle: (year, month) => `${year}年${month + 1}月`,
      dayLabel: (year, month, day, weekday) => `${year}年${month + 1}月${day}日 ${ZH_WEEKDAYS[weekday]}`,
    },
    editor: {
      insertTaskCommand: "插入任务或将所选行转为任务",
      dateButtons: "任务日期",
      dateButtonLabel: (kindLabel, value) => `${kindLabel}：${value}`,
    },
    view: {
      toggle: "任务视图",
      searchPlaceholder: "筛选任务",
      sortFields: { due: "截止日期", created: "创建日期", done: "完成日期", file: "文件", text: "任务内容" },
      building: "正在读取任务…",
      emptyScope: "这里还没有任务。",
      emptyFiltered: "没有符合当前搜索或筛选条件的任务。",
      checkboxLabel: (text) => `完成“${text}”`,
      chipLabel: (kindLabel, value, status) => `${kindLabel}：${value}${status ? `（${status}）` : ""}`,
      dueOverdue: "已逾期",
      dueToday: "今天到期",
      chipDate: (year, month, day, withYear) => `${withYear ? `${year}年` : ""}${month + 1}月${day}日`,
      fullDate: (year, month, day) => `${year}年${month + 1}月${day}日`,
      openTask: "在笔记中打开任务",
      openFile: (title) => `打开“${title}”`,
      subtaskProgress: (completed, total) => `已完成 ${completed}/${total} 个子任务`,
      saving: "正在保存…",
      menu: { open: "打开任务", openInNewTab: "在新标签页中打开任务", copyText: "复制任务内容" },
      copied: "已复制任务内容。",
      copyFailed: "无法复制任务内容。",
      errors: {
        lineNotFound: "笔记中的这条任务已变化，列表正在刷新。",
        missingFile: "这条任务所在的笔记已不存在。",
        notATask: "这一行已不再是任务。",
        writeFailed: "无法更新任务。",
      },
    },
  },
};
