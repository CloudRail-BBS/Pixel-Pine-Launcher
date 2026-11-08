/** 极验 4.0 加载器。
 *
 * 只在服务端启用了人机验证时才拉脚本——没启用的实例不该多下载 100KB。
 * 成功回调只触发一次，所以每次验证都要用新的处理函数。 */

export interface GeetestResult {
  lot_number: string;
  captcha_output: string;
  pass_token: string;
  gen_time: string;
}

interface GeetestInstance {
  appendTo: (target: HTMLElement | string) => void;
  onSuccess: (callback: () => void) => void;
  onError: (callback: (error: unknown) => void) => void;
  getValidate: () => GeetestResult | null;
}

declare global {
  interface Window {
    initGeetest4?: (
      config: Record<string, unknown>,
      callback: (captcha: GeetestInstance) => void,
    ) => void;
  }
}

let loading: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.initGeetest4) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://static.geetest.com/v4/gt4.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("人机验证脚本加载失败，检查网络后重试"));
    document.head.appendChild(script);
  });
  return loading;
}

export async function mountGeetest(
  captchaId: string,
  container: HTMLElement,
  onSuccess: (result: GeetestResult) => void,
): Promise<void> {
  await loadSdk();
  if (!window.initGeetest4) throw new Error("人机验证初始化失败");

  window.initGeetest4({ captchaId, product: "bind", language: "zho" }, (captcha) => {
    captcha.appendTo(container);
    captcha.onSuccess(() => {
      const result = captcha.getValidate();
      if (result) onSuccess(result);
    });
  });
}
