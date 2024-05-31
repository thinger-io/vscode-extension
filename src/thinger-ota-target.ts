import { QuickPickItem, window, Disposable, CancellationToken, QuickInputButton, QuickInput, ExtensionContext, QuickInputButtons, Uri, QuickPick } from 'vscode';
import { ThingerAPI } from './thinger-api';
import { ThingerConfig, ThingerOTATarget } from './thinger-config';
import axios from 'axios';

export class ThingerOTATargetPicker {

	private api: ThingerAPI;
    private fillResourcesBound: (type: string, search: string, input: QuickPick<QuickPickItem>) => Promise<void>;
	private cancelTokenSource: any;

	constructor(config: ThingerConfig) {
		this.api = new ThingerAPI(config);
		this.fillResourcesBound = this.fillResources.bind(this);
	}

	private async fillResources(type: string, search: string, input: QuickPick<QuickPickItem>) : Promise<void> {
		// if control is busy, clear pending request
		if (input.busy && this.cancelTokenSource) {
            this.cancelTokenSource.cancel('Operation canceled due to a new request.');
		}

		// update the current cancel token
		this.cancelTokenSource = axios.CancelToken.source();

		// mark control as busy
		input.busy = true;

		try {
			let response;
			if (type === 'device') {
				response = await this.api.getDevices(search, this.cancelTokenSource.token);
			} else if (type === 'product') {
				response = await this.api.getProducts(search, this.cancelTokenSource.token);
			}

			let items: QuickPickItem[] = [];
			response?.data.forEach((element: any) => {
				if(type==='device'){
					const connected = element.connection?.active? '●' : '○';
					items.push({ label: `${connected} ${element[type]}`, description: element.name, detail: element.description });
				}else{
					items.push({ label: element[type], description: element.name, detail: element.description });
				}
			});

			input.items = items;
		} catch (error: any) {
			if (!axios.isCancel(error)) {
				if (error?.response?.status === 403) {
					window.showErrorMessage(`Cannot retrieve ${type}s. Please check your Token permissions.`);
				}
				console.error('Error while loading resources', error);
			}else{
				console.log('Request cancelled', error);
			}
		} finally {
			input.busy = false;
		}

	}

	public async pickTarget() : Promise<ThingerOTATarget> {

		interface ResourceType extends QuickPickItem {
			type: 'device' | 'product' | 'asset_type' | 'asset_group'
		}

		interface State {
			title: string;
			step: number;
			totalSteps: number;
			resourceGroup: QuickPickItem | string;
			name: string;
			runtime: QuickPickItem;
		}

		async function selectResource() {
			const selected = {} as Partial<ThingerOTATarget>;
			await MultiStepInput.run(input => pickThingerOTATarget(input, selected));
			return selected as ThingerOTATarget;
		}

		const title = 'Configure OTA Destination';

		async function pickThingerOTATarget(input: MultiStepInput, resource: Partial<ThingerOTATarget>) {

			const resourceTypes: ResourceType[] = [
				{
					type: 'device',
					label: '$(rocket) Device',
					//description: 'Select a device',
					detail: 'Select a device to send the OTA update',
				},
				{
					type: 'product',
					label: '$(package) Product',
					//description: 'Select a product',
					detail: 'Select a product for bulk OTA update',
				}/*,
			{
				type: 'asset_type',
				label: 'Asset Type',
				description: 'Select an asset type',
				detail: 'Select an asset type to send the OTA update',
			},
			{
				type: 'asset_group',
				label: 'Asset Group',
				description: 'Select an asset group',
				detail: 'Select an asset group to send the OTA update',
			}*/
			];

			const selectedType = await input.showQuickPick({
				title,
				step: 1,
				totalSteps: 2,
				placeholder: 'Pick a resource type',
				items: resourceTypes,
				//activeItem: typeof state.resourceGroup !== 'string' ? state.resourceGroup : undefined,
				buttons: [],
				shouldResume: shouldResume
			});

			// button on the top right
			const res = selectedType as ResourceType;
			resource.type = res.type;
			return (input: MultiStepInput) => pickResource(res.type, input, resource);
		}

		const that = this;

		async function pickResource(type: string, input: MultiStepInput, resource: Partial<ThingerOTATarget>) {

			const pick = await input.showQuickPick({
				type: type,
				title,
				step: 2,
				totalSteps: 2,
				placeholder: `Select or search for a ${type}`,
				items: [],
				fetchItems: that.fillResourcesBound,
				//activeItem: resource.id,
				shouldResume: shouldResume,
			});

			if(type==='device'){
				// remove the connected status from the label
				resource.id = pick.label.split(' ')[1];
			}else{
				resource.id = pick.label;
			}
		}

		function shouldResume() {
			// Could show a notification with the option to resume.
			return new Promise<boolean>((resolve, reject) => {
				// noop
			});
		}

		return await selectResource();
	}

}

class InputFlowAction {
	static back = new InputFlowAction();
	static cancel = new InputFlowAction();
	static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends QuickPickItem> {
	type?: string;
	title: string;
	step: number;
	totalSteps: number;
	items: T[];
	activeItem?: T;
	ignoreFocusOut?: boolean;
	placeholder: string;
	buttons?: QuickInputButton[];
	fetchItems?: (type: string, search: string, input: QuickPick<QuickPickItem>) => Promise<void>;
	shouldResume: () => Thenable<boolean>;
}

class MultiStepInput {

	private current?: QuickInput;
	private steps: InputStep[] = [];

	static async run<T>(start: InputStep) {
		const input = new MultiStepInput();
		return input.stepThrough(start);
	}

	private async stepThrough<T>(start: InputStep) {
		let step: InputStep | void = start;
		while (step) {
			this.steps.push(step);
			if (this.current) {
				this.current.enabled = false;
				this.current.busy = true;
			}
			try {
				step = await step(this);
			} catch (err) {
				if (err === InputFlowAction.back) {
					this.steps.pop();
					step = this.steps.pop();
				} else if (err === InputFlowAction.resume) {
					step = this.steps.pop();
				} else if (err === InputFlowAction.cancel) {
					step = undefined;
				} else {
					throw err;
				}
			}
		}
		if (this.current) {
			this.current.dispose();
		}
	}

	async showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>>({ type, title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, buttons, fetchItems, shouldResume }: P) {
		const disposables: Disposable[] = [];
		try {
			return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
				const input = window.createQuickPick<T>();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.ignoreFocusOut = ignoreFocusOut ?? false;
				input.placeholder = placeholder;
				input.items = items;
				if (activeItem) {
					input.activeItems = [activeItem];
				}
				input.buttons = [
					...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
					...(buttons || [])
				];
				disposables.push(
					input.onDidChangeValue(value => {
						type && fetchItems && fetchItems(type, value, input);
					}),
					input.onDidTriggerButton(item => {
						if (item === QuickInputButtons.Back) {
							reject(InputFlowAction.back);
						} else {
							resolve(<any>item);
						}
					}),
					input.onDidChangeSelection(items => resolve(items[0])),
					input.onDidHide(() => {
						(async () => {
							reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
						})()
							.catch(reject);
					})
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current.show();
				type && fetchItems && fetchItems(type, '', input);
			});
		} finally {
			disposables.forEach(d => d.dispose());
		}
	}

}