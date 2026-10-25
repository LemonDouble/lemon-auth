// tsup 이 SVG 를 문자열로 인라인한다 (tsup.config.ts 의 loader).
declare module "*.svg" {
  const markup: string;
  export default markup;
}
