import {useSyncExternalStore} from "react";

export interface App {
    id: string,
    name: string,
    bin: string,
    cmd: string,
    workdir: string,
    flatpak: boolean,
    shortcut: number | null | undefined,
    lastOpened: number | null | undefined,
    favorite: boolean | null | undefined,
    hidden: boolean | null | undefined,
}
export type Apps = Map<string, App>;

export interface SortedApps {
    favorites: App[],
    flatpaks: App[],
    apps: App[],
    hidden: App[],
    loaded: boolean,
}

class AppsStorage {
    protected apps: Apps = new Map();
    protected sortedApps: SortedApps = {favorites: [], flatpaks: [], apps: [], hidden: [], loaded: false} as SortedApps;
    protected listeners = new Set<() => void>();

    public subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public getSorted = () => {
        return this.sortedApps;
    }

    public setApps = (apps: Apps) => {
        this.apps = apps;
        this.sortedApps = AppsStorage.sort([...this.apps.values()]);
        this.notifyListeners();
    }

    public updateApp = (id: string, modifier: (app: App) => void) => {
        const app = this.apps.get(id);
        if (!app) throw new Error(`App with id ${id} not found`);

        const newApp = {...app};
        modifier(newApp);
        this.apps.set(id, newApp);

        this.setApps(this.apps);
    }

    protected notifyListeners() {
        this.listeners.forEach(listener => listener());
    }

    protected static sort(apps: App[]): SortedApps {
        const res = {favorites: [], flatpaks: [], apps: [], hidden: [], loaded: true} as SortedApps;

        apps.forEach(app => {
            if (app.hidden) res.hidden.push(app);
            else if (app.favorite) res.favorites.push(app);
            else if (app.flatpak) res.flatpaks.push(app);
            else res.apps.push(app);
        });

        res.flatpaks.sort(AppsStorage.sortCompare);
        res.apps.sort(AppsStorage.sortCompare);
        res.favorites.sort(AppsStorage.sortCompareByName);
        res.hidden.sort(AppsStorage.sortCompareByName);

        return res;
    }

    protected static sortCompareByName(a: App, b: App): number {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    }

    // recently opened apps first, then alphabetically. apps with shortcuts are always sorted alphabetically.
    protected static sortCompare(a: App, b: App): number{
        const aIsRecent = a.lastOpened != null && a.shortcut == null;
        const bIsRecent = b.lastOpened != null && b.shortcut == null;

        if (aIsRecent && bIsRecent) {
            return b.lastOpened! - a.lastOpened! || AppsStorage.sortCompareByName(a, b);
        }
        if (aIsRecent) return -1;
        if (bIsRecent) return 1;

        return AppsStorage.sortCompareByName(a, b);
    }
}

export const appsStorage = new AppsStorage();
export const useSortedApps = () => useSyncExternalStore(appsStorage.subscribe, appsStorage.getSorted);