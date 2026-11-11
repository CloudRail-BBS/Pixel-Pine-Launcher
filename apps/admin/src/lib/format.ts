/** 后台通用格式化。 */

/** 字节数 → 人类可读。后台里到处是体积，统一一份免得各处口径不一。 */
export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 审计日志里的动作码 → 中文，认不出来的原样返回。 */
export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    approve: "通过审核",
    reject: "驳回",
    takedown: "下架",
    restore: "恢复上架",
    package_delete: "删除资源",
    report_handled: "处理举报",
    report_dismissed: "忽略举报",
    admin_login: "后台登录",
    admin_login_failed: "登录失败",
    game_manifest_update: "更新游戏清单",
    game_upload: "上传游戏包",
    launcher_publish: "推送更新清单",
    announcement_create: "发布公告",
    announcement_delete: "删除公告",
    package_create: "创建资源",
    version_upload: "上传版本",
    package_submit: "提交审核",
  };
  return map[action] ?? action;
}
