// tsup 이 이미지를 data URL 문자열로 인라인한다 (tsup.config.ts 의 loader).
declare module "*.webp" {
  const dataUrl: string;
  export default dataUrl;
}
