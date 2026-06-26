export interface ControllerCommandDetail<TCommand extends string = string> {
  command: TCommand;
  [key: string]: unknown;
}

export function dispatchControllerEvent<TDetail>(eventName: string, detail: TDetail) {
  window.dispatchEvent(new CustomEvent<TDetail>(eventName, { detail }));
}

export function dispatchControllerCommand<TDetail extends ControllerCommandDetail>(
  eventName: string,
  detail: TDetail,
) {
  dispatchControllerEvent(eventName, detail);
}
