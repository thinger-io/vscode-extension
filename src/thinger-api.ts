import * as axiosConfig from './util/axios-instance';
import axios, { AxiosRequestConfig, CancelTokenSource, CancelToken } from 'axios';
import { ThingerConfig } from "./thinger-config";

export class ThingerAPI {

    constructor(config: ThingerConfig) {
        this.config = config;
    }

    private async createConfig(cancelToken?: CancelToken): Promise<AxiosRequestConfig> {
        return {
            cancelToken: cancelToken,
            ...this.axiosConfig,
        };
    }

    public async getDevices(search: String, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v1/users/${user}/devices?name=${search}&type=Generic&count=10`;
        return this.axiosInstance.get(resource, config);
    }

    public async getProducts(search: String, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v1/users/${user}/products?name=${search}&count=10`;
        return this.axiosInstance.get(resource, config);
    }

    public async getProductDevices(product: string, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v1/users/${user}/devices?product=${product}&type=Generic&count=0`;
        return this.axiosInstance.get(resource, config);
    }

    public async getDeviceOTAOptions(device: string, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v3/users/${user}/devices/${device}/resources/$ota/options`;
        return this.axiosInstance.get(resource, config);
    }

    public async beginDeviceOTA(device: string, options: any, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v3/users/${user}/devices/${device}/resources/$ota/begin`;
        return this.axiosInstance.post(resource, options, config);
    }

    public async writeDeviceOTA(device: string, data: any, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v3/users/${user}/devices/${device}/resources/$ota/write`;
        return this.axiosInstance.post(resource, data, {
            ...config,
            headers: {
                'Content-Type': 'application/octet-stream'
            }
        });
    }

    public async endDeviceOTA(device: string, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v3/users/${user}/devices/${device}/resources/$ota/end`;
        return this.axiosInstance.post(resource, undefined, config);
    }

    public async rebootDeviceOTA(device: string, cancelToken?: CancelToken) {
        const config = await this.createConfig(cancelToken);
        const user = await this.config.getUser();
        const resource = `/v3/users/${user}/devices/${device}/resources/$ota/reboot`;
        return this.axiosInstance.post(resource, undefined, config);
    }

    private axiosInstance = axiosConfig.getInstance();
    private config: ThingerConfig;
    private axiosConfig = {}; // Additional Axios config if needed
}
