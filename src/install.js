import View from './components/view'
import Link from './components/link'

export let _Vue

export function install (Vue) {
  if (install.installed && _Vue === Vue) return // 避免重复安装
  install.installed = true

  _Vue = Vue

  const isDef = v => v !== undefined

  // 为路由记录、router-view关联路由组件
  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    // 调用vm.$options._parentVnode.data.registerRouteInstance方法
    // 而这个方法只在router-view组件中存在，router-view组件定义在(../components/view.js @71行)
    // 所以，如果vm的父节点为router-view，则为router-view关联当前vm，即将当前vm做为router-view的路由组件
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

  // 注册全局混入
  Vue.mixin({
    beforeCreate () {
      // this === new Vue({router:router}) === Vue根实例

      // 判断是否使用了vue-router插件
      if (isDef(this.$options.router)) {
        // 在Vue根实例上保存一些信息
        this._routerRoot = this // 保存挂载VueRouter的Vue实例，此处为根实例
        this._router = this.$options.router // 保存VueRouter实例，this.$options.router仅存在于Vue根实例上，其它Vue组件不包含此属性，所以下面的初始化，只会执行一次
        // beforeCreate hook被触发时，调用
        this._router.init(this) // 初始化VueRouter实例，并传入Vue根实例

        // 响应式定义_route属性，保证_route发生变化时，组件(router-view)会重新渲染
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else {
        // 回溯查找_routerRoot
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      // 为router-view组件关联路由组件
      registerInstance(this, this)
    },
    destroyed () {
      // destroyed hook触发时，取消router-view和路由组件的关联
      registerInstance(this)
    }
  })

  // 在原型上注入$router、$route属性，方便快捷访问
  Object.defineProperty(Vue.prototype, '$router', {
    get () { return this._routerRoot._router }
  })

  Object.defineProperty(Vue.prototype, '$route', {
    // 每个组件访问到的$route，其实最后访问的都是Vue根实例的_route
    get () { return this._routerRoot._route }
  })

  // 注册router-view、router-link全局组件
  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)

  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
