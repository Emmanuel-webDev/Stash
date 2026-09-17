// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SavingsVault
 * @author Nze
 * @notice Non-custodial automated savings vault on Arc (USDC).
 *         Users configure a basis-point savings rate; a whitelisted relayer
 *         calls `depositFor` whenever a qualifying spend event is detected.
 *         Users can pause/resume relayer monitoring at any time without
 *         losing their saved funds or configuration.
 *
 * Security surface covered:
 *  - Reentrancy guard on all state-mutating external calls
 *  - CEI (Checks-Effects-Interactions) on withdraw
 *  - Relayer whitelist enforced on depositFor
 *  - Per-user pause flag — relayer rejects deposits for paused users
 *  - Basis-point bounds enforced on configure (100–2000)
 *  - Pull-over-push withdrawal pattern (user initiates, no push)
 *  - No admin withdrawal — owner cannot touch user funds
 *  - Integer overflow impossible (Solidity 0.8 built-in checks)
 *  - Zero-amount guards on deposit and withdraw
 *  - Pausable circuit breaker (owner only, emergency use)
 *  - SafeERC20 transfer wrappers for non-standard USDC edge cases
 */

// ─────────────────────────────────────────────────────────────
// Minimal SafeERC20 (avoids importing full OZ just for this)
// ─────────────────────────────────────────────────────────────
interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);
}

library SafeERC20 {
    function safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(
                token.transferFrom.selector,
                from,
                to,
                amount
            )
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "SafeERC20: transferFrom failed"
        );
    }

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, amount)
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "SafeERC20: transfer failed"
        );
    }
}

// ─────────────────────────────────────────────────────────────
// SavingsVault
// ─────────────────────────────────────────────────────────────
contract SavingsVault {
    using SafeERC20 for IERC20;

    // ── Constants ────────────────────────────────────────────
    uint256 public constant MIN_BASIS_POINTS = 100; // 1%
    uint256 public constant MAX_BASIS_POINTS = 2000; // 20%
    uint256 public constant BASIS_DIVISOR = 10_000;

    // ── Immutables ───────────────────────────────────────────
    IERC20 public immutable usdc;
    address public immutable owner;

    // ── Relayer ──────────────────────────────────────────────
    address public relayer;

    // ── Emergency circuit breaker ────────────────────────────
    bool public paused; // owner-level pause (emergency only)

    // ── Per-user state ───────────────────────────────────────
    struct UserConfig {
        uint256 basisPoints; // savings rate
        bool active; // has the user configured a vault?
        bool listeningPaused; // user opted out of auto-savings temporarily
    }

    mapping(address => UserConfig) private _configs;
    mapping(address => uint256) private _balances;

    // ── Reentrancy guard ─────────────────────────────────────
    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "Vault: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ── Circuit breaker ───────────────────────────────────────
    modifier whenNotPaused() {
        require(!paused, "Vault: contract paused");
        _;
    }

    // ── Access control ────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Vault: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Vault: not relayer");
        _;
    }

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    /// @notice User set or updated their savings rate
    event Configured(address indexed user, uint256 basisPoints);

    /// @notice Relayer deposited USDC into a user's vault
    event Deposited(address indexed user, uint256 amount, uint256 totalBalance);

    /// @notice User withdrew funds from their vault
    event Withdrawn(
        address indexed user,
        uint256 amount,
        uint256 remainingBalance
    );

    /// @notice User paused relayer auto-savings (opts out temporarily)
    event ListeningPaused(address indexed user);

    /// @notice User resumed relayer auto-savings (opts back in)
    event ListeningResumed(address indexed user);

    /// @notice Relayer address updated by owner
    event RelayerUpdated(
        address indexed oldRelayer,
        address indexed newRelayer
    );

    /// @notice Emergency pause toggled by owner
    event ContractPaused(bool paused);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    constructor(address _usdc, address _relayer) {
        require(_usdc != address(0), "Vault: zero usdc");
        require(_relayer != address(0), "Vault: zero relayer");

        usdc = IERC20(_usdc);
        relayer = _relayer;
        owner = msg.sender;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ─────────────────────────────────────────────────────────
    // User-facing: configure
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Set or update savings rate.
     * @param basisPoints  100 = 1%, 2000 = 20%. Must be in [100, 2000].
     * @dev   Does NOT re-enable listening if the user had paused it.
     *        Calling configure is purely a rate update.
     */
    function configure(uint256 basisPoints) external whenNotPaused {
        require(
            basisPoints >= MIN_BASIS_POINTS && basisPoints <= MAX_BASIS_POINTS,
            "Vault: rate out of range"
        );

        UserConfig storage cfg = _configs[msg.sender];
        cfg.basisPoints = basisPoints;
        cfg.active = true;
        // NOTE: listeningPaused is intentionally NOT reset here.

        emit Configured(msg.sender, basisPoints);
    }

    // ─────────────────────────────────────────────────────────
    // User-facing: pause / resume listening
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Pause the relayer from depositing into your vault.
     *         Funds already saved remain untouched. Rate config is preserved.
     *         The relayer MUST check `isListening(user)` before calling
     *         `depositFor` and skip paused users.
     */
    function pauseListening() external {
        UserConfig storage cfg = _configs[msg.sender];
        require(cfg.active, "Vault: no active config");
        require(!cfg.listeningPaused, "Vault: already paused");

        cfg.listeningPaused = true;
        emit ListeningPaused(msg.sender);
    }

    /**
     * @notice Resume relayer auto-savings after a pause.
     */
    function resumeListening() external {
        UserConfig storage cfg = _configs[msg.sender];
        require(cfg.active, "Vault: no active config");
        require(cfg.listeningPaused, "Vault: not paused");

        cfg.listeningPaused = false;
        emit ListeningResumed(msg.sender);
    }

    // ─────────────────────────────────────────────────────────
    // Relayer-callable: depositFor
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Route a savings amount into a user's vault.
     * @param  user    The wallet being monitored.
     * @param  amount  Raw USDC amount (already computed as spendAmount × basisPoints / 10000).
     *
     * Security:
     *  - Only callable by the whitelisted relayer.
     *  - Reverts if the user has not configured a vault.
     *  - Reverts if the user has paused listening.
     *  - Reverts if amount is zero.
     *  - nonReentrant: the USDC transferFrom cannot re-enter.
     *  - CEI: state updated BEFORE external call (balance credited first,
     *    then token pulled — safe because we track internal balances
     *    independently of the token contract).
     */
    function depositFor(
        address user,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyRelayer {
        require(user != address(0), "Vault: zero user");
        require(amount > 0, "Vault: zero amount");

        UserConfig storage cfg = _configs[user];
        require(cfg.active, "Vault: user not configured");
        require(!cfg.listeningPaused, "Vault: user paused listening");

        // ── Effects ──────────────────────────────────────────
        _balances[user] += amount;

        // ── Interactions ─────────────────────────────────────
        // Relayer must have pulled USDC from user wallet before calling this,
        // OR the relayer itself holds the USDC and transfers it in here.
        // Either way the allowance/balance must exist at this point.
        usdc.safeTransferFrom(user, address(this), amount);
        emit Deposited(user, amount, _balances[user]);
    }

    // ─────────────────────────────────────────────────────────
    // User-facing: withdraw
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Withdraw any amount up to full balance. Non-custodial.
     * @param  amount  USDC amount to withdraw (6-decimal).
     *
     * Security:
     *  - nonReentrant: blocks any re-entry through the USDC transfer callback.
     *  - CEI strictly enforced: balance decremented BEFORE transfer.
     *  - No admin override — only msg.sender can withdraw their own balance.
     *  - Works even when the user has paused listening (funds always accessible).
     *  - Works even when the contract is NOT paused (withdrawal always open).
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Vault: zero amount");

        uint256 bal = _balances[msg.sender];
        require(bal >= amount, "Vault: insufficient balance");

        // ── Effects (before interaction) ─────────────────────
        _balances[msg.sender] = bal - amount;

        // ── Interactions ─────────────────────────────────────
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, _balances[msg.sender]);
    }

    // ─────────────────────────────────────────────────────────
    // View functions
    // ─────────────────────────────────────────────────────────

    /// @notice Current saved balance for a user (USDC, 6 decimals)
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }

    /// @notice Savings rate in basis points (100 = 1%)
    function configOf(
        address user
    ) external view returns (uint256 basisPoints) {
        return _configs[user].basisPoints;
    }

    /// @notice Whether the relayer is actively routing savings for this user
    function isListening(address user) external view returns (bool) {
        UserConfig storage cfg = _configs[user];
        return cfg.active && !cfg.listeningPaused;
    }

    /// @notice Full user config snapshot
    function userConfig(
        address user
    )
        external
        view
        returns (
            uint256 basisPoints,
            bool active,
            bool listeningPaused,
            uint256 balance
        )
    {
        UserConfig storage cfg = _configs[user];
        return (
            cfg.basisPoints,
            cfg.active,
            cfg.listeningPaused,
            _balances[user]
        );
    }

    // ─────────────────────────────────────────────────────────
    // Owner-only: relayer management + circuit breaker
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Rotate the relayer address (e.g. infrastructure upgrade).
     * @dev    Old relayer loses deposit rights immediately.
     */
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Vault: zero relayer");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    /**
     * @notice Emergency pause — freezes configure + depositFor.
     *         Withdrawals remain open regardless.
     * @dev    Owner should be a multisig in production.
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit ContractPaused(_paused);
    }

    // ─────────────────────────────────────────────────────────
    // Safety: reject plain ETH sends
    // ─────────────────────────────────────────────────────────
    receive() external payable {
        revert("Vault: no ETH accepted");
    }
    fallback() external payable {
        revert("Vault: no ETH accepted");
    }
}
