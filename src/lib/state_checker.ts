import { v4 as uuid } from "uuid";

class StateChecker {
  private state: string;
  private timer: NodeJS.Timeout;

  constructor() {
    this.state = uuid();
    this.timer = setInterval(() => {
      this.state = uuid();
    }, 5 * 60 * 1000);
  }
  get currentState() {
    return this.state;
  }

  validate(stateToValidate: string) {
    return this.state === stateToValidate;
  }
}

const stateChecker = new StateChecker();
export default stateChecker;
