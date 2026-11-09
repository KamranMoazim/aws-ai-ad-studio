declare module '@sparticuz/chromium' {
  const chromium: {
    args: string[];
    executablePath(input?: string): Promise<string>;
  };
  export default chromium;
}
