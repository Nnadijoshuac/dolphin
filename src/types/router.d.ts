/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string | object = string> {
      hrefInputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownInputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownInputParams }
        | { pathname: `/`; params?: Router.UnknownInputParams }
        | { pathname: `/(tabs)`; params?: Router.UnknownInputParams }
        | { pathname: `/(tabs)/categories`; params?: Router.UnknownInputParams }
        | { pathname: `/(tabs)/search`; params?: Router.UnknownInputParams }
        | { pathname: `/(tabs)/my-agents`; params?: Router.UnknownInputParams }
        | { pathname: `/(tabs)/profile`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/index`; params?: Router.UnknownInputParams }
        | { pathname: `/agent/[id]`; params: { id: string } }
        | { pathname: `/category/[slug]`; params: { slug: string } }
        | { pathname: `/hire/[id]`; params: { id: string } }
        | { pathname: `/manage/[id]`; params: { id: string } }
        | { pathname: `/_sitemap`; params?: Router.UnknownInputParams };
      hrefOutputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownOutputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownOutputParams }
        | { pathname: `/`; params?: Router.UnknownOutputParams }
        | { pathname: `/(tabs)`; params?: Router.UnknownOutputParams }
        | { pathname: `/(tabs)/categories`; params?: Router.UnknownOutputParams }
        | { pathname: `/(tabs)/search`; params?: Router.UnknownOutputParams }
        | { pathname: `/(tabs)/my-agents`; params?: Router.UnknownOutputParams }
        | { pathname: `/(tabs)/profile`; params?: Router.UnknownOutputParams }
        | { pathname: `/onboarding`; params?: Router.UnknownOutputParams }
        | { pathname: `/onboarding/index`; params?: Router.UnknownOutputParams }
        | { pathname: `/agent/[id]`; params: { id: string } }
        | { pathname: `/category/[slug]`; params: { slug: string } }
        | { pathname: `/hire/[id]`; params: { id: string } }
        | { pathname: `/manage/[id]`; params: { id: string } }
        | { pathname: `/_sitemap`; params?: Router.UnknownOutputParams };
      href:
        | Router.RelativePathString
        | Router.ExternalPathString
        | `/`
        | `/(tabs)`
        | `/(tabs)/categories`
        | `/(tabs)/search`
        | `/(tabs)/my-agents`
        | `/(tabs)/profile`
        | `/onboarding`
        | `/onboarding/index`
        | `/agent/${string}`
        | `/category/${string}`
        | `/hire/${string}`
        | `/manage/${string}`
        | `/_sitemap`
        | { pathname: `/agent/[id]`; params: { id: string } }
        | { pathname: `/category/[slug]`; params: { slug: string } }
        | { pathname: `/hire/[id]`; params: { id: string } }
        | { pathname: `/manage/[id]`; params: { id: string } }
        | { pathname: string; params?: Router.UnknownInputParams };
    }
  }
}
