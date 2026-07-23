export const codeOk = (code: string) =>
  /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code.trim()) || /diss\.app\//i.test(code);

export const initialsOf = (name: string) =>
  (name || 'M C').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

export const fmtElapsed = (sec: number) => {
  const m = Math.floor(sec / 60);
  return `${m < 10 ? '0' : ''}${m}:${sec % 60 < 10 ? '0' : ''}${sec % 60}`;
};
