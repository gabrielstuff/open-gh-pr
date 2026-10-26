import { withGitHub } from "./auth";
import { RepoPicker } from "./repos";

export default withGitHub(({ token }) => <RepoPicker token={token} />);
