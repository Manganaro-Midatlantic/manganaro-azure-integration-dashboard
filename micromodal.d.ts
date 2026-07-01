declare module "micromodal" {
  interface MicroModalOptions {
    onShow?: (modal: HTMLElement) => void;
    onClose?: (modal: HTMLElement) => void;
    openTrigger?: string;
    closeTrigger?: string;
    openClass?: string;
    disableScroll?: boolean;
    disableFocus?: boolean;
    awaitOpenAnimation?: boolean;
    awaitCloseAnimation?: boolean;
    debugMode?: boolean;
  }
  const MicroModal: {
    init(config?: MicroModalOptions): void;
    show(targetModal: string, config?: MicroModalOptions): void;
    close(targetModal?: string): void;
  };
  export default MicroModal;
}
