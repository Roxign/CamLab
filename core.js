// Core math and render logic (non-UI-specific)
const chessCanvas = document.getElementById('canvas');
const chessCtx = chessCanvas.getContext('2d');
chessCanvas._undistortTable = null;

const curveCanvas = document.getElementById('curveCanvas');
const curveCtx = curveCanvas.getContext('2d');

const directionCanvas = document.getElementById('directionCanvas');
const directionCtx = directionCanvas.getContext('2d');

const DIRECTION_CANVAS_MAX_WIDTH = 220;
const DIRECTION_CANVAS_MAX_HEIGHT = 135;
const CHESSBOARD_MASK_MAX_DIMENSION = 2048;

// Extrinsics state (global)
let rx_wc = 0, ry_wc = 0, rz_wc = 0, tx_wc = 0, ty_wc = 0, tz_wc = 1000;
let rx_cw = 0, ry_cw = 0, rz_cw = 0, tx_cw = 0, ty_cw = 0, tz_cw = -1000;

function getIntrinsics() {
    return [
        parseFloat(document.getElementById('psText').value),
        parseFloat(document.getElementById('iw').value),
        parseFloat(document.getElementById('ih').value),
        parseFloat(document.getElementById('fx').value),
        parseFloat(document.getElementById('fy').value),
        parseFloat(document.getElementById('cx').value),
        parseFloat(document.getElementById('cy').value)
    ];
}

function getDistortion() {
    return [
        parseFloat(document.getElementById('k1').value),
        parseFloat(document.getElementById('k2').value),
        parseFloat(document.getElementById('p1').value),
        parseFloat(document.getElementById('p2').value),
        parseFloat(document.getElementById('k3').value),
        parseFloat(document.getElementById('k4').value),
        parseFloat(document.getElementById('k5').value),
        parseFloat(document.getElementById('k6').value),
        document.getElementById('fisheye').checked
    ];
}

function getChessboardSettings() {
    return [
        parseFloat(document.getElementById('bc').value),
        parseFloat(document.getElementById('br').value),
        parseFloat(document.getElementById('bw').value),
        parseFloat(document.getElementById('bh').value),
        document.getElementById('centerAtCenter').classList.contains('active'),
        document.getElementById('showSquares').checked,
        document.getElementById('showCircles').checked,
        document.getElementById('extraWhitePadding')?.checked ?? false
    ];
}

function getChessboardCornerRanges(bc, br, center) {
    return {
        xMin: center ? -(bc - 1) / 2 : 0,
        xMax: center ? bc / 2 : bc,
        yMin: center ? -(br - 1) / 2 : 0,
        yMax: center ? br / 2 : br
    };
}

function getChessboardMaskCacheKey(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, bc, br, bw, bh, center, extraWhitePadding) {
    return [
        chessCanvas.width, chessCanvas.height,
        iw, ih, fx, fy, cx, cy,
        k1, k2, p1, p2, k3, k4, k5, k6, fisheye ? 1 : 0,
        rx_cw, ry_cw, rz_cw, tx_cw, ty_cw, tz_cw,
        bc, br, bw, bh, center ? 1 : 0, extraWhitePadding ? 1 : 0
    ].map(value => Number.isFinite(value) ? Number(value).toFixed(6) : String(value)).join('|');
}

function getChessboardBoundaryCornerWorldPoints() {
    const [bc, br, bw, bh, center] = getChessboardSettings();
    const { xMin, xMax, yMin, yMax } = getChessboardCornerRanges(bc, br, center);
    const xValues = [];
    const yValues = [];

    for (let x = xMin; x < xMax; x += 1) xValues.push(x);
    for (let y = yMin; y < yMax; y += 1) yValues.push(y);

    if (xValues.length === 0 || yValues.length === 0) return [];

    const boundaryPoints = [];
    const topY = yValues[0] * bh;
    const bottomY = yValues[yValues.length - 1] * bh;
    const leftX = xValues[0] * bw;
    const rightX = xValues[xValues.length - 1] * bw;

    for (const x of xValues) boundaryPoints.push([x * bw, topY, 0]);
    for (let i = 1; i < yValues.length; i++) boundaryPoints.push([rightX, yValues[i] * bh, 0]);
    if (yValues.length > 1) {
        for (let i = xValues.length - 2; i >= 0; i--) boundaryPoints.push([xValues[i] * bw, bottomY, 0]);
    }
    if (xValues.length > 1) {
        for (let i = yValues.length - 2; i > 0; i--) boundaryPoints.push([leftX, yValues[i] * bh, 0]);
    }

    return boundaryPoints;
}

function getProjectedChessboardContourPoints() {
    const [, , , fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const contourPoints = [];

    for (const point3d of getChessboardBoundaryCornerWorldPoints()) {
        const [u, v, zc] = projectPointToImage(point3d, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        if (!isFinite(u) || !isFinite(v) || zc <= 0) {
            return [];
        }
        contourPoints.push([u, v]);
    }

    return contourPoints;
}

function calculateChessboardMaskCoverage() {
    const [, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [bc, br, bw, bh, center, , , extraWhitePadding] = getChessboardSettings();

    if (!isFinite(iw) || !isFinite(ih) || iw <= 0 || ih <= 0 || !isFinite(fx) || !isFinite(fy)) {
        return { occupiedPixelCount: 0, totalPixels: 0, coverageRatio: NaN };
    }

    const cacheKey = getChessboardMaskCacheKey(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, bc, br, bw, bh, center, extraWhitePadding);
    if (chessCanvas._maskStatsCache?.key === cacheKey) {
        return chessCanvas._maskStatsCache.value;
    }

    const imageWidth = Math.max(1, Math.round(iw));
    const imageHeight = Math.max(1, Math.round(ih));
    const totalPixels = imageWidth * imageHeight;
    const maskScale = Math.min(1, CHESSBOARD_MASK_MAX_DIMENSION / Math.max(imageWidth, imageHeight, 1));
    const maskWidth = Math.max(1, Math.round(imageWidth * maskScale));
    const maskHeight = Math.max(1, Math.round(imageHeight * maskScale));
    const rasterTotalPixels = maskWidth * maskHeight;
    const contourPoints = getProjectedChessboardContourPoints().map(([u, v]) => [u * maskScale, v * maskScale]);

    if (contourPoints.length < 3 || rasterTotalPixels <= 0) {
        const emptyValue = { occupiedPixelCount: 0, totalPixels, coverageRatio: NaN };
        chessCanvas._maskStatsCache = { key: cacheKey, value: emptyValue };
        return emptyValue;
    }

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

    if (!maskCtx) {
        return { occupiedPixelCount: 0, totalPixels, coverageRatio: NaN };
    }

    maskCtx.clearRect(0, 0, maskWidth, maskHeight);
    maskCtx.fillStyle = '#ffffff';
    maskCtx.beginPath();
    maskCtx.moveTo(contourPoints[0][0], contourPoints[0][1]);
    for (let i = 1; i < contourPoints.length; i++) {
        maskCtx.lineTo(contourPoints[i][0], contourPoints[i][1]);
    }
    maskCtx.closePath();
    maskCtx.fill();

    const maskData = maskCtx.getImageData(0, 0, maskWidth, maskHeight).data;
    let occupiedMaskPixels = 0;
    for (let i = 3; i < maskData.length; i += 4) {
        if (maskData[i] > 0) occupiedMaskPixels += 1;
    }

    const coverageRatio = rasterTotalPixels > 0 ? occupiedMaskPixels / rasterTotalPixels : NaN;
    const value = {
        occupiedPixelCount: isFinite(coverageRatio) ? Math.round(coverageRatio * totalPixels) : 0,
        totalPixels,
        coverageRatio
    };
    chessCanvas._maskStatsCache = { key: cacheKey, value };
    return value;
}

function getChessboardMetrics() {
    const [, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [bc, br, bw, bh, center, , , extraWhitePadding] = getChessboardSettings();
    const { xMin, xMax, yMin, yMax } = getChessboardCornerRanges(bc, br, center);
    const { coverageRatio } = calculateChessboardMaskCoverage();

    const totalWidth = (bc + 1 + (extraWhitePadding ? 2 : 0)) * bw;
    const totalHeight = (br + 1 + (extraWhitePadding ? 2 : 0)) * bh;
    const projectedPoints = [];

    for (let y = yMin; y < yMax; y++) {
        const row = [];
        for (let x = xMin; x < xMax; x++) {
            const [u, v, zc] = projectPointToImage([x * bw, y * bh, 0], fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
            const visible = isFinite(u) && isFinite(v) && zc > 0 && u >= 0 && u <= iw && v >= 0 && v <= ih;
            row.push({ u, v, visible });
        }
        projectedPoints.push(row);
    }

    let minCornerGapPx = Infinity;
    for (let row = 0; row < projectedPoints.length; row++) {
        for (let col = 0; col < projectedPoints[row].length; col++) {
            const point = projectedPoints[row][col];
            if (!point?.visible) continue;

            const right = projectedPoints[row][col + 1];
            const down = projectedPoints[row + 1]?.[col];

            if (right?.visible) {
                minCornerGapPx = Math.min(minCornerGapPx, Math.hypot(point.u - right.u, point.v - right.v));
            }
            if (down?.visible) {
                minCornerGapPx = Math.min(minCornerGapPx, Math.hypot(point.u - down.u, point.v - down.v));
            }
        }
    }

    return {
        totalWidth,
        totalHeight,
        minCornerGapPx: isFinite(minCornerGapPx) ? minCornerGapPx : null,
        coverageRatio
    };
}

function eulerAnglesToRotationMatrix(rx, ry, rz) {
    const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
    const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
    const cosRz = Math.cos(rz), sinRz = Math.sin(rz);
    const R11 = cosRy * cosRz;
    const R12 = cosRy * sinRz;
    const R13 = -sinRy;
    const R21 = sinRx * sinRy * cosRz - cosRx * sinRz;
    const R22 = sinRx * sinRy * sinRz + cosRx * cosRz;
    const R23 = sinRx * cosRy;
    const R31 = cosRx * sinRy * cosRz + sinRx * sinRz;
    const R32 = cosRx * sinRy * sinRz - sinRx * cosRz;
    const R33 = cosRx * cosRy;
    return [R11, R12, R13, R21, R22, R23, R31, R32, R33];
}

function rotationMatrixToEulerAngles(R11, R12, R13, R21, R22, R23, R31, R32, R33) {
    const ry = -Math.asin(R13);
    const rz = Math.atan2(R12, R11);
    const rx = Math.atan2(R23, R33);
    return [rx, ry, rz];
}

function applyDistortion(xc, yc, zc, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    // Comments are the original perspective division, but it can cause issues when zc is negative (point behind the camera) or close to zero. Using absolute value of zc can help visualize points behind the camera and avoid extreme distortion for points close to the camera.
    // let xp = xc / zc;
    // let yp = yc / zc;
    let xp = xc / Math.abs(zc);
    let yp = yc / Math.abs(zc);

    if (fisheye) {
        const r = Math.sqrt(xp * xp + yp * yp);
        if (r > 0) {
            // Comments are the original fisheye distortion formula, but it can cause issues when zc is negative (point behind the camera) or close to zero. Using atan2 with absolute value of zc can help visualize points behind the camera and avoid extreme distortion for points close to the camera.
            // let theta1 = Math.atan(Math.sqrt(xc * xc + yc * yc) / zc);
            const theta1 = Math.atan2(Math.sqrt(xc * xc + yc * yc), zc);
            const theta2 = theta1 * theta1;
            const theta3 = theta2 * theta1;
            const theta5 = theta2 * theta3;
            const theta7 = theta2 * theta5;
            const theta9 = theta2 * theta7;
            const theta_d = theta1 + k1 * theta3 + k2 * theta5 + k3 * theta7 + k4 * theta9;
            xp = (theta_d / r) * xp;
            yp = (theta_d / r) * yp;
        }
    } else {
        const r2 = xp * xp + yp * yp;
        const r4 = r2 * r2;
        const r6 = r4 * r2;
        const radial = (1 + k1 * r2 + k2 * r4 + k3 * r6) / (1 + k4 * r2 + k5 * r4 + k6 * r6);
        const dtx = 2 * p1 * xp * yp + p2 * (r2 + 2 * xp * xp);
        const dty = p1 * (r2 + 2 * yp * yp) + 2 * p2 * xp * yp;
        xp = xp * radial + dtx;
        yp = yp * radial + dty;
    }

    return [xp, yp];
}

function projectPointToImage(p3d, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    const [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);
    const [xw, yw, zw] = p3d;

    const xc = R11 * xw + R12 * yw + R13 * zw + tx_wc;
    const yc = R21 * xw + R22 * yw + R23 * zw + ty_wc;
    const zc = R31 * xw + R32 * yw + R33 * zw + tz_wc;

    const [xp, yp] = applyDistortion(xc, yc, zc, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    const u = fx * xp + cx;
    const v = fy * yp + cy;

    return [u, v, zc];
}

function projectPoint(p3d, iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    let [u, v, zc] = projectPointToImage(p3d, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    u = u * chessCanvas.width / iw;
    v = v * chessCanvas.height / ih;
    return [u, v, zc];
}

function undistortNormalized(xDist, yDist, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, maxIter = 30, eps = 1e-3) {
    const dampingStep = 10.0;
    const dampingMin = 1e-20;
    const dampingMax = 1e20;

    if (fisheye) {
        const thetaDist = Math.hypot(xDist, yDist);
        if (thetaDist === 0) return [0, 0, 1];

        const evaluateTheta = (theta) => {
            const t2 = theta * theta;
            const t3 = t2 * theta;
            const t4 = t2 * t2;
            const t5 = t3 * t2;
            const t6 = t3 * t3;
            const t7 = t4 * t3;
            const t8 = t4 * t4;
            const t9 = t5 * t4;
            const thetaPred = theta + k1 * t3 + k2 * t5 + k3 * t7 + k4 * t9;
            const error = thetaDist - thetaPred;
            const jacobian = 1 + 3 * k1 * t2 + 5 * k2 * t4 + 7 * k3 * t6 + 9 * k4 * t8;
            return { error, cost: error * error, jacobian };
        };

        let theta = Math.min(thetaDist, Math.PI - 1e-6);
        let damping = 1e-3;
        let state = evaluateTheta(theta);

        for (let iter = 0; iter < maxIter; iter++) {
            if (!isFinite(state.cost) || !isFinite(state.jacobian)) break;

            let H = state.jacobian * state.jacobian;
            H = H < 1e-12 ? H + damping : H + H * damping;
            if (!isFinite(H) || Math.abs(H) < 1e-20) {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
                continue;
            }

            const delta = (state.jacobian * state.error) / H;
            if (!isFinite(delta)) {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
                continue;
            }

            const thetaCandidate = Math.max(0, Math.min(theta + delta, Math.PI - 1e-6));
            const nextState = evaluateTheta(thetaCandidate);

            if (nextState.cost < state.cost) {
                const step2 = delta * delta;
                theta = thetaCandidate;
                state = nextState;
                damping = Math.max(damping / dampingStep, dampingMin);
                if (step2 < 1e-12) break;
            } else {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
            }
        }

        const z = theta > Math.PI * 0.5 ? -1 : 1;
        const frontTheta = z > 0 ? theta : (Math.PI - theta);
        const r = Math.tan(frontTheta);
        const scale = r / thetaDist;
        return [xDist * scale, yDist * scale, z];
    } else {
        const evaluatePerspective = (x, y) => {
            const r2 = x * x + y * y;
            const r4 = r2 * r2;
            const r6 = r4 * r2;

            const A = 1 + k1 * r2 + k2 * r4 + k3 * r6;
            const B = 1 + k4 * r2 + k5 * r4 + k6 * r6;
            const invB = Math.abs(B) > 1e-12 ? 1 / B : 1;
            const factor = A * invB;

            const xPred = x * factor + 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
            const yPred = y * factor + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
            const ex = xDist - xPred;
            const ey = yDist - yPred;

            const dA_dx = x * (2 * k1 + 4 * k2 * r2 + 6 * k3 * r4);
            const dA_dy = y * (2 * k1 + 4 * k2 * r2 + 6 * k3 * r4);
            const dB_dx = x * (2 * k4 + 4 * k5 * r2 + 6 * k6 * r4);
            const dB_dy = y * (2 * k4 + 4 * k5 * r2 + 6 * k6 * r4);

            const invB2 = invB * invB;
            const dfactor_dx = (dA_dx * B - A * dB_dx) * invB2;
            const dfactor_dy = (dA_dy * B - A * dB_dy) * invB2;

            const J00 = factor + x * dfactor_dx + 2 * p1 * y + 6 * p2 * x;
            const J01 = x * dfactor_dy + 2 * p1 * x + 2 * p2 * y;
            const J10 = y * dfactor_dx + 2 * p1 * x + 2 * p2 * y;
            const J11 = factor + y * dfactor_dy + 6 * p1 * y + 2 * p2 * x;

            return {
                ex,
                ey,
                cost: ex * ex + ey * ey,
                J00,
                J01,
                J10,
                J11
            };
        };

        let x = xDist;
        let y = yDist;
        let damping = 1e-3;
        let state = evaluatePerspective(x, y);

        for (let iter = 0; iter < maxIter; ++iter) {
            if (!isFinite(state.cost)) break;

            const JTJ00 = state.J00 * state.J00 + state.J10 * state.J10;
            const JTJ01 = state.J00 * state.J01 + state.J10 * state.J11;
            const JTJ11 = state.J01 * state.J01 + state.J11 * state.J11;
            const JTe0 = state.J00 * state.ex + state.J10 * state.ey;
            const JTe1 = state.J01 * state.ex + state.J11 * state.ey;

            let H00 = JTJ00 < 1e-12 ? JTJ00 + damping : JTJ00 + JTJ00 * damping;
            const H01 = JTJ01;
            const H10 = JTJ01;
            let H11 = JTJ11 < 1e-12 ? JTJ11 + damping : JTJ11 + JTJ11 * damping;

            let det = H00 * H11 - H01 * H10;
            if (!isFinite(det) || Math.abs(det) < 1e-24) {
                H00 += damping;
                H11 += damping;
                det = H00 * H11 - H01 * H10;
                if (!isFinite(det) || Math.abs(det) < 1e-30) {
                    damping = Math.min(damping * dampingStep, dampingMax);
                    if (damping >= dampingMax) break;
                    continue;
                }
            }

            const invDet = 1.0 / det;
            const dx = (H11 * JTe0 - H01 * JTe1) * invDet;
            const dy = (-H10 * JTe0 + H00 * JTe1) * invDet;

            if (!isFinite(dx) || !isFinite(dy) || Math.abs(dx) > 1e6 || Math.abs(dy) > 1e6) {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
                continue;
            }

            const xCandidate = x + dx;
            const yCandidate = y + dy;
            const nextState = evaluatePerspective(xCandidate, yCandidate);

            if (nextState.cost < state.cost) {
                const stepNorm2 = dx * dx + dy * dy;
                x = xCandidate;
                y = yCandidate;
                state = nextState;
                damping = Math.max(damping / dampingStep, dampingMin);
                if (stepNorm2 < eps) break;
            } else {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
            }
        }

        return [x, y, 1];
    }
}

function updateUndistortTable(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    const width = chessCanvas.width;
    const height = chessCanvas.height;
    const dx = new Float32Array(width * height);
    const dy = new Float32Array(width * height);
    const dz = new Float32Array(width * height);

    const fxCanvas = fx * width / iw;
    const fyCanvas = fy * height / ih;
    const cxCanvas = cx * width / iw;
    const cyCanvas = cy * height / ih;

    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            const xDist = (u - cxCanvas) / fxCanvas;
            const yDist = (v - cyCanvas) / fyCanvas;
            const [xu, yu, zu] = undistortNormalized(xDist, yDist, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
            const idx = v * width + u;
            dx[idx] = xu;
            dy[idx] = yu;
            dz[idx] = zu;
        }
    }

    return [dx, dy, dz, width, height];
}

function renderChessboard() {
    const [, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [bc, br, bw, bh, center, showSquares, showCircles, extraWhitePadding] = getChessboardSettings();

    chessCtx.clearRect(0, 0, chessCanvas.width, chessCanvas.height);

    if (showSquares) {
        const width = chessCanvas.width;
        const height = chessCanvas.height;
        const img = chessCtx.getImageData(0, 0, width, height);
        const data = img.data;

        if (!chessCanvas._undistortTable) {
            chessCanvas._undistortTable = updateUndistortTable(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        }
        const [dxTable, dyTable, dzTable] = chessCanvas._undistortTable;

        const [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_cw, ry_cw, rz_cw);
        const boardXMin = (center ? -(bc + 1) / 2 : -1) * bw;
        const boardXMax = (center ? (bc + 1) / 2 : bc) * bw;
        const boardYMin = (center ? -(br + 1) / 2 : -1) * bh;
        const boardYMax = (center ? (br + 1) / 2 : br) * bh;
        const paddedXMin = extraWhitePadding ? boardXMin - bw : boardXMin;
        const paddedXMax = extraWhitePadding ? boardXMax + bw : boardXMax;
        const paddedYMin = extraWhitePadding ? boardYMin - bh : boardYMin;
        const paddedYMax = extraWhitePadding ? boardYMax + bh : boardYMax;

        for (let v = 0; v < height; v++) {
            for (let u = 0; u < width; u++) {
                const idx = v * width + u;
                const dx_v = dxTable[idx];
                const dy_v = dyTable[idx];
                const dz_v = dzTable[idx];

                const dwx = R11 * dx_v + R12 * dy_v + R13 * dz_v;
                const dwy = R21 * dx_v + R22 * dy_v + R23 * dz_v;
                const dwz = R31 * dx_v + R32 * dy_v + R33 * dz_v;

                if (dwz !== 0) {
                    const s = -tz_cw / dwz;
                    if (s > 0) {
                        const X = tx_cw + s * dwx;
                        const Y = ty_cw + s * dwy;
                        if (X >= paddedXMin && X <= paddedXMax && Y >= paddedYMin && Y <= paddedYMax) {
                            const inWhitePadding = extraWhitePadding
                                && (X < boardXMin || X > boardXMax || Y < boardYMin || Y > boardYMax);
                            let color = 255;
                            if (!inWhitePadding) {
                                const xi = Math.floor((X - boardXMin) / bw);
                                const yi = Math.floor((Y - boardYMin) / bh);
                                color = ((xi + yi) % 2 === 0) ? 255 : 0;
                            }
                            const pixel = idx * 4;
                            data[pixel] = color;
                            data[pixel + 1] = color;
                            data[pixel + 2] = color;
                            data[pixel + 3] = 255;
                        }
                    }
                }
            }
        }

        chessCtx.putImageData(img, 0, 0);
    }

    if (showCircles) {
        const { xMin, xMax, yMin, yMax } = getChessboardCornerRanges(bc, br, center);

        for (let y = yMin; y < yMax; y++) {
            for (let x = xMin; x < xMax; x++) {
                const p3d = [x * bw, y * bh, 0];
                const [u, v, zc] = projectPoint(p3d, iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
                chessCtx.fillStyle = zc > 0 ? 'red' : 'blue';
                chessCtx.beginPath();
                chessCtx.arc(u, v, 3, 0, 2 * Math.PI);
                chessCtx.fill();
            }
        }
    }
}

function findFovLimit(rayDirX, rayDirY, incomingStepDeg = 0.09) {
    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();

    const norm = Math.hypot(rayDirX, rayDirY);
    const dirX = norm === 0 ? 1 : rayDirX / norm;
    const dirY = norm === 0 ? 0 : rayDirY / norm;

    const incomingStepRad = incomingStepDeg * Math.PI / 180;
    const maxIncomingAngleRad = Math.PI - 1e-6;
    const maxSteps = Math.ceil(maxIncomingAngleRad / incomingStepRad) + 1;
    let previousReflectedAngle = null;
    let limitAngle = 0;

    for (let i = 0; i < maxSteps; i++) {
        const angle = Math.min(i * incomingStepRad, maxIncomingAngleRad);
        const rayZ = angle > Math.PI * 0.5 ? -1 : 1;
        const incomingSlope = Math.tan(rayZ > 0 ? angle : (Math.PI - angle));
        const xu = dirX * incomingSlope;
        const yu = dirY * incomingSlope;
        const [xDist, yDist] = applyDistortion(xu, yu, rayZ, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        const u = fx * xDist + cx;
        const v = fy * yDist + cy;
        const inResolution = u >= 0 && u <= iw && v >= 0 && v <= ih;

        if (!inResolution) {
            break;
        }

        const reflectedAngle = Math.atan(Math.hypot(xDist, yDist));
        if (previousReflectedAngle !== null && reflectedAngle < previousReflectedAngle) {
            limitAngle = angle;
            break;
        }

        previousReflectedAngle = reflectedAngle;
        limitAngle = angle;

        if (angle >= maxIncomingAngleRad) {
            break;
        }
    }

    return limitAngle;
}
