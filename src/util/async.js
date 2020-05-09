/* @flow */
// 队列执行函数
// queue 需要执行的队列
// fn 迭代函数
// cb 回调函数
export function runQueue (queue: Array<?NavigationGuard>, fn: Function, cb: Function) {
  const step = index => {
    // 全部执行完，执行回调
    if (index >= queue.length) {
      cb()
    } else {
      // 存在，执行迭代函数
      if (queue[index]) {
        fn(queue[index], /* next*/() => {
          step(index + 1)
        })
      } else {
        // 否则，跳到下个执行
        step(index + 1)
      }
    }
  }
  step(0)
}
