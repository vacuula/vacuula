import axios from "axios";
import i18n from "./i18n";
import { Neato, type QuickRobotInfo } from "./types";
import type { NoGoLine, VacuulaMapData, Zone } from "./components/map/types";

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipLoader?: boolean;
  }
}

const ha_ingress = window.location.pathname.match(/^\/api\/hassio_ingress\/[^/]+/)
export const BASE_PATH = ha_ingress ? ha_ingress[0] : ""

/** GET /api/server */
export interface ServerInfo {
  version: string
  min_installer_version: string
  gen3_port: number
  gen4_port: number

  timezone: string
  utc_offset_minutes: number
}

const instance = axios.create({
  baseURL: `${BASE_PATH}/api`, 
});

export type LoadingState = { isLoading: boolean; message?: string };

let loadingStateCallback: ((state: LoadingState) => void) | null = null;
let pendingRequests = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const startLoading = () => {
  pendingRequests += 1;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (pendingRequests === 1) {
    loadingStateCallback?.({ isLoading: true, message: i18n.t('common.sendingCommand') });
  }
};

const stopLoading = () => {
  pendingRequests = Math.max(0, pendingRequests - 1);
  if (pendingRequests === 0) {
    // small delay avoids flicker when requests fire back to back
    hideTimer = setTimeout(() => {
      hideTimer = null;
      loadingStateCallback?.({ isLoading: false });
    }, 150);
  }
};


instance.interceptors.request.use((config) => {
  if (!config.skipLoader) startLoading();
  return config;
});

instance.interceptors.response.use(
  (response) => {
    if (!response.config.skipLoader) stopLoading();
    return response;
  },
  (error) => {
    if (!error.config?.skipLoader) stopLoading();
    return Promise.reject(error);
  }
);

export class Http {
  static sendCmd<T>(robotSerial: string, cmd: object) {
    return instance.post<T>(`/robot/${robotSerial}/command`, JSON.stringify(cmd));
  }

  static getPersistentMaps(serial: string) {
    return instance.get<Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[]>(`/robot/${serial}/maps`)
  }

  static getPersistentMap(serial: string, mapId: string) {
    return instance.get<VacuulaMapData>(`/robot/${serial}/maps/${mapId}`)
  }

  static postUseMapAsFloorPlan(serial: string, mapId: string) {
    return instance.post(`/robot/${serial}/maps/${mapId}/use`)
  }

  static postUnuseMapAsFloorPlan(serial: string, mapId: string) {
    return instance.post(`/robot/${serial}/maps/${mapId}/unuse`)
  }

  static updatePersistentMap(serial: string, mapId: string, data: { name?: string, enabled?: boolean }) {
    return instance.post(`/robot/${serial}/maps/${mapId}`, data)
  }

  static postBoundaries(serial: string, mapId: string, data: (NoGoLine | Zone)[]) {
    return instance.post(`/robot/${serial}/maps/${mapId}/boundaries`, data)
  }

  static getBoundaries(serial: string, mapId: string) {
    return instance.get(`/robot/${serial}/maps/${mapId}/boundaries`)
  }

  static promoteFloorplan(serial: string, mapId: string) {
    return instance.post(`/robot/${serial}/maps/${mapId}/promote`)
  }

  static getCleanings(serial: string) {
    return instance.get(`/robot/${serial}/runs`)
  }

  static getCleaning(serial: string, runId: string) {
    return instance.get(`/robot/${serial}/run/${runId}`)
  }

  static deleteFloorplan(serial: string, mapId: string) {
    return instance.delete(`/robot/${serial}/maps/${mapId}`)
  }

  // TODO: look over if i want this as a put or not
  static restoreFloorplan(serial: string, mapId: string) {
    return instance.put(`/robot/${serial}/maps/${mapId}`)
  }

  static getRobots() {
    return instance.get<QuickRobotInfo>('/robots');
  }

  /** Server facts the UI needs: the IANA timezone it runs in and its current UTC offset. */
  static getServerInfo() {
    return instance.get<ServerInfo>('/server');
  }

  static getVacuulaCert() {
    return instance.get('/cert');
  }

  static updateRobot(serial: string, data: { name: string }) {
    return instance.post(`/robot/${serial}`, data)
  }

  static setLoadingStateCallback(cb: ((state: LoadingState) => void) | null) {
    loadingStateCallback = cb;
  }
}


