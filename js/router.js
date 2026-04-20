class Router {
  constructor() {
    this._routes = {};
    this._currentRoute = null;
    this._beforeHooks = [];
    window.addEventListener('hashchange', () => this._handleRoute());
  }

  register(path, handler) {
    this._routes[path] = handler;
  }

  beforeEach(hook) {
    this._beforeHooks.push(hook);
  }

  navigate(path) {
    window.location.hash = path;
  }

  getCurrentRoute() {
    return this._currentRoute;
  }

  getParam(name) {
    const hash = window.location.hash.slice(1);
    const parts = hash.split('/');
    const routeKeys = Object.keys(this._routes);

    for (const route of routeKeys) {
      const routeParts = route.split('/');
      if (routeParts.length !== parts.length) continue;

      let match = true;
      const params = {};

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = parts[i];
        } else if (routeParts[i] !== parts[i]) {
          match = false;
          break;
        }
      }

      if (match && params[name]) return params[name];
    }

    return null;
  }

  start() {
    if (!window.location.hash) {
      window.location.hash = '/';
    }
    this._handleRoute();
  }

  _handleRoute() {
    const hash = window.location.hash.slice(1) || '/';

    for (const hook of this._beforeHooks) {
      const result = hook(hash);
      if (result === false) return;
    }

    const { handler, params } = this._matchRoute(hash);

    if (handler) {
      this._currentRoute = hash;
      handler(params);
    } else {
      this.navigate('/');
    }
  }

  _matchRoute(path) {
    if (this._routes[path]) {
      return { handler: this._routes[path], params: {} };
    }

    const parts = path.split('/');

    for (const [route, handler] of Object.entries(this._routes)) {
      const routeParts = route.split('/');
      if (routeParts.length !== parts.length) continue;

      let match = true;
      const params = {};

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = decodeURIComponent(parts[i]);
        } else if (routeParts[i] !== parts[i]) {
          match = false;
          break;
        }
      }

      if (match) return { handler, params };
    }

    return { handler: null, params: {} };
  }
}

export const router = new Router();
