// SPDX-License-Identifier: LicenseRef-Dolphin-View-Only
pragma solidity ^0.8.24;

/**
 * DolphinSwapGuard - the only thing an agent's trade key should be allowed to
 * call. (Mentor review, 2026-09-29: "the part of the agent that reasons should
 * not directly hold the power to act... enforce limits where the model can't
 * reach them.")
 *
 * WHY IT EXISTS. Altana's session keys constrain a call's TARGET and FUNCTION,
 * never its arguments. A key allowed to call PancakeSwap's router directly can
 * therefore name any recipient. With this guard in between, the key may call
 * only the guard, and the guard fixes the arguments that matter:
 *
 *   - RECIPIENT: always msg.sender - the wallet that called. There is no
 *     parameter for it. A stolen key can only ever swap a wallet's funds back
 *     into that same wallet.
 *   - TOKENS: every token on the path must be on an allow-list fixed at
 *     deployment. No swapping a user into a token an attacker controls.
 *   - MINIMUM OUTPUT: at least (1 - maxSlippageBps) of the router's own quote
 *     at execution time, and the output actually received is checked.
 *   - SOURCE OF FUNDS: tokens are pulled only from msg.sender. An allowance a
 *     wallet gives the guard can be spent only by that wallet's own calls.
 *
 * KNOWN LIMIT, stated plainly: the minimum-output floor is measured against
 * the pool's spot quote at execution, which a well-funded attacker can move in
 * the same block. It stops a zero-minimum trade; it does not stop a
 * sandwich by someone who can also move the pool. A time-weighted oracle
 * would; it is not built.
 *
 * STATUS: written and tested against mock contracts (contracts/test). NOT
 * DEPLOYED and NOT AUDITED. Do not point real funds at it until an external
 * audit has signed it off.
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPancakeV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline
    ) external;
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin, address[] calldata path, address to, uint256 deadline
    ) external payable;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline
    ) external;
}

contract DolphinSwapGuard {
    IPancakeV2Router public immutable router;
    address public immutable wbnb;
    /** Largest allowed shortfall against the router's quote, in basis points. */
    uint16 public immutable maxSlippageBps;
    mapping(address => bool) public allowedToken;

    uint256 private locked = 1;

    error TokenNotAllowed(address token);
    error BadPath();
    error MinimumTooLow(uint256 floor, uint256 given);
    error ReceivedTooLittle(uint256 minimum, uint256 received);
    error TransferFailed();
    error Reentrant();

    event GuardedSwap(address indexed wallet, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    modifier nonReentrant() {
        if (locked != 1) revert Reentrant();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address router_, address wbnb_, address[] memory tokens, uint16 maxSlippageBps_) {
        require(router_ != address(0) && wbnb_ != address(0), "zero address");
        require(maxSlippageBps_ > 0 && maxSlippageBps_ <= 1000, "slippage 0.01%-10%");
        router = IPancakeV2Router(router_);
        wbnb = wbnb_;
        maxSlippageBps = maxSlippageBps_;
        allowedToken[wbnb_] = true;
        for (uint256 i = 0; i < tokens.length; i++) allowedToken[tokens[i]] = true;
    }

    /// Token -> token. Proceeds go to the caller, always.
    function swapTokens(address[] calldata path, uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 received) {
        _checkPath(path);
        uint256 pulled = _pull(path[0], amountIn);
        _checkMinimum(pulled, path, minOut);
        IERC20(path[0]).approve(address(router), pulled);
        address out = path[path.length - 1];
        uint256 before = IERC20(out).balanceOf(msg.sender);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(pulled, minOut, path, msg.sender, block.timestamp);
        received = IERC20(out).balanceOf(msg.sender) - before;
        if (received < minOut) revert ReceivedTooLittle(minOut, received);
        emit GuardedSwap(msg.sender, path[0], out, pulled, received);
    }

    /// BNB -> token. Proceeds go to the caller, always.
    function swapBNBForTokens(address[] calldata path, uint256 minOut) external payable nonReentrant returns (uint256 received) {
        _checkPath(path);
        if (path[0] != wbnb) revert BadPath();
        _checkMinimum(msg.value, path, minOut);
        address out = path[path.length - 1];
        uint256 before = IERC20(out).balanceOf(msg.sender);
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(minOut, path, msg.sender, block.timestamp);
        received = IERC20(out).balanceOf(msg.sender) - before;
        if (received < minOut) revert ReceivedTooLittle(minOut, received);
        emit GuardedSwap(msg.sender, wbnb, out, msg.value, received);
    }

    /// Token -> BNB. The BNB goes to the caller, always.
    function swapTokensForBNB(address[] calldata path, uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 received) {
        _checkPath(path);
        if (path[path.length - 1] != wbnb) revert BadPath();
        uint256 pulled = _pull(path[0], amountIn);
        _checkMinimum(pulled, path, minOut);
        IERC20(path[0]).approve(address(router), pulled);
        uint256 before = msg.sender.balance;
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(pulled, minOut, path, msg.sender, block.timestamp);
        received = msg.sender.balance - before;
        if (received < minOut) revert ReceivedTooLittle(minOut, received);
        emit GuardedSwap(msg.sender, path[0], wbnb, pulled, received);
    }

    function _checkPath(address[] calldata path) private view {
        if (path.length < 2 || path.length > 3) revert BadPath();
        for (uint256 i = 0; i < path.length; i++) {
            if (!allowedToken[path[i]]) revert TokenNotAllowed(path[i]);
        }
        if (path[0] == path[path.length - 1]) revert BadPath();
    }

    /// Pulls from the caller only, and returns what actually arrived.
    function _pull(address token, uint256 amount) private returns (uint256) {
        uint256 before = IERC20(token).balanceOf(address(this));
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        return IERC20(token).balanceOf(address(this)) - before;
    }

    function _checkMinimum(uint256 amountIn, address[] calldata path, uint256 minOut) private view {
        uint256[] memory amounts = router.getAmountsOut(amountIn, path);
        uint256 floor = (amounts[amounts.length - 1] * (10_000 - maxSlippageBps)) / 10_000;
        if (minOut < floor || minOut == 0) revert MinimumTooLow(floor, minOut);
    }
}
