// UI handlers and event bindings.
const paramTab = document.getElementById('paramTab');
const tableTab = document.getElementById('tableTab');
const paramTableRows = ['fx-row', 'fy-row', 'cx-row', 'cy-row', 'k1-row', 'k2-row', 'p1-row', 'p2-row', 'k3-row', 'k4-row', 'k5-row', 'k6-row', 'kb-row'];
const tableTextboxes = document.getElementById('table-textboxes');
const distortionLabelRow = document.getElementById('distortion-label-row');

const viewChessboardBtn = document.getElementById('viewChessboard');
const world2camBtn = document.getElementById('world2cam');
const cam2worldBtn = document.getElementById('cam2world');
const centerAtTLBtn = document.getElementById('centerAtTL');
const centerAtCTBtn = document.getElementById('centerAtCenter');

const viewCurveBtn = document.getElementById('viewCurve');
const curveAxisOptions = document.getElementById('curveAxisOptions');
const curveDirectionAngleSlider = document.getElementById('curveDirectionAngle');
const curveDirectionAngleText = document.getElementById('curveDirectionAngleText');
const curveXUnitGroup = document.getElementById('curveXUnitGroup');
const curveYUnitGroup = document.getElementById('curveYUnitGroup');

const curveXUnitDeg = document.getElementById('curveXUnitDeg');
const curveXUnitRad = document.getElementById('curveXUnitRad');
const curveXUnitSlope = document.getElementById('curveXUnitSlope');
const curveXUnitPixel = document.getElementById('curveXUnitPixel');
const curveXUnitUm = document.getElementById('curveXUnitUm');
const curveXUnitMm = document.getElementById('curveXUnitMm');
const curveXUnitCm = document.getElementById('curveXUnitCm');
const curveXUnitM = document.getElementById('curveXUnitM');

const curveYUnitDeg = document.getElementById('curveYUnitDeg');
const curveYUnitRad = document.getElementById('curveYUnitRad');
const curveYUnitSlope = document.getElementById('curveYUnitSlope');
const curveYUnitPixel = document.getElementById('curveYUnitPixel');
const curveYUnitUm = document.getElementById('curveYUnitUm');
const curveYUnitMm = document.getElementById('curveYUnitMm');
const curveYUnitCm = document.getElementById('curveYUnitCm');
const curveYUnitM = document.getElementById('curveYUnitM');

const curveDirectionTLBtn = document.querySelector('#curveDirectionControls button[aria-label="Top-left"]');
const curveDirectionTBtn = document.querySelector('#curveDirectionControls button[aria-label="Top"]');
const curveDirectionTRBtn = document.querySelector('#curveDirectionControls button[aria-label="Top-right"]');
const curveDirectionLBtn = document.querySelector('#curveDirectionControls button[aria-label="Left"]');
const curveDirectionRBtn = document.querySelector('#curveDirectionControls button[aria-label="Right"]');
const curveDirectionBLBtn = document.querySelector('#curveDirectionControls button[aria-label="Bottom-left"]');
const curveDirectionBBtn = document.querySelector('#curveDirectionControls button[aria-label="Bottom"]');
const curveDirectionBRBtn = document.querySelector('#curveDirectionControls button[aria-label="Bottom-right"]');

let curveAxes = {
    x: null,
    y: null
};

function setupCurveAxisUI() {
    const xOptions = [curveXUnitDeg, curveXUnitRad, curveXUnitSlope, curveXUnitPixel, curveXUnitUm, curveXUnitMm, curveXUnitCm, curveXUnitM];
    const yOptions = [curveYUnitDeg, curveYUnitRad, curveYUnitSlope, curveYUnitPixel, curveYUnitUm, curveYUnitMm, curveYUnitCm, curveYUnitM];

    xOptions.forEach(option => { if (option) option.name = 'curveXUnit'; });
    yOptions.forEach(option => { if (option) option.name = 'curveYUnit'; });

    curveAxes = {
        x: {
            unitGroup: curveXUnitGroup,
            unitOptions: xOptions.filter(Boolean),
            state: { unit: (xOptions.find(o => o?.checked) || curveXUnitDeg)?.value || 'deg' }
        },
        y: {
            unitGroup: curveYUnitGroup,
            unitOptions: yOptions.filter(Boolean),
            state: { unit: (yOptions.find(o => o?.checked) || curveYUnitDeg)?.value || 'deg' }
        }
    };

    curveDirectionTLBtn.addEventListener('click', () => setCurveDirectionFromPreset('TL'));
    curveDirectionTBtn.addEventListener('click', () => setCurveDirectionFromPreset('T'));
    curveDirectionTRBtn.addEventListener('click', () => setCurveDirectionFromPreset('TR'));
    curveDirectionLBtn.addEventListener('click', () => setCurveDirectionFromPreset('L'));
    curveDirectionRBtn.addEventListener('click', () => setCurveDirectionFromPreset('R'));
    curveDirectionBLBtn.addEventListener('click', () => setCurveDirectionFromPreset('BL'));
    curveDirectionBBtn.addEventListener('click', () => setCurveDirectionFromPreset('B'));
    curveDirectionBRBtn.addEventListener('click', () => setCurveDirectionFromPreset('BR'));

}

function setParamTableMode(mode) {
    const showParam = mode === 'param';
    paramTab.classList.toggle('active', showParam);
    paramTab.setAttribute('aria-selected', showParam ? 'true' : 'false');
    tableTab.classList.toggle('active', !showParam);
    tableTab.setAttribute('aria-selected', showParam ? 'false' : 'true');

    for (const rowId of paramTableRows) {
        const row = document.getElementById(rowId);
        if (row) row.style.display = showParam ? '' : 'none';
    }

    if (distortionLabelRow) distortionLabelRow.style.display = showParam ? '' : 'none';
    if (tableTextboxes) tableTextboxes.style.display = showParam ? 'none' : 'flex';
}

function updateChessboardOriginTabs(mode = 'center') {
    const isCenter = mode === 'center';
    centerAtCTBtn.classList.toggle('active', isCenter);
    centerAtTLBtn.classList.toggle('active', !isCenter);
    centerAtCTBtn.setAttribute('aria-selected', isCenter ? 'true' : 'false');
    centerAtTLBtn.setAttribute('aria-selected', isCenter ? 'false' : 'true');
}

function toggleChessUI(enabled) {
    viewChessboardBtn.classList.toggle('active', enabled);
    viewChessboardBtn.setAttribute('aria-selected', enabled ? 'true' : 'false');
    if (enabled) {
        viewCurveBtn.classList.remove('active');
        viewCurveBtn.setAttribute('aria-selected', 'false');
        document.getElementById('canvas').classList.remove('hidden');
        document.getElementById('canvas').style.display = 'block';
    } else {
        document.getElementById('canvas').classList.add('hidden');
        document.getElementById('canvas').style.display = 'none';
    }
}

function toggleCurveUI(enabled) {
    viewCurveBtn.classList.toggle('active', enabled);
    viewCurveBtn.setAttribute('aria-selected', enabled ? 'true' : 'false');
    if (enabled) {
        viewChessboardBtn.classList.remove('active');
        viewChessboardBtn.setAttribute('aria-selected', 'false');
        curveAxisOptions.classList.remove('hidden');
        curveCanvas.classList.remove('hidden');
        curveCanvas.style.display = 'block';
    } else {
        curveAxisOptions.classList.add('hidden');
        curveCanvas.classList.add('hidden');
        curveCanvas.style.display = 'none';
    }
}

function updateExtrinsicModeButtons(mode = 'world2cam') {
    if (mode === 'world2cam') {
        world2camBtn.classList.add('active');
        cam2worldBtn.classList.remove('active');
        world2camBtn.setAttribute('aria-selected', 'true');
        cam2worldBtn.setAttribute('aria-selected', 'false');
    } else {
        cam2worldBtn.classList.add('active');
        world2camBtn.classList.remove('active');
        cam2worldBtn.setAttribute('aria-selected', 'true');
        world2camBtn.setAttribute('aria-selected', 'false');
    }
}


function getCurveAxisValue(axisKey, slope, rayZ, focalLengthPx, pixelSizeUm) {
    const { state } = curveAxes[axisKey];
    const unit = state.unit;

    if (unit === 'rad' || unit === 'deg' || unit === 'tanθ') {
        const frontAngle = Math.atan(slope);
        const angleRad = axisKey === 'x' && rayZ < 0 ? (Math.PI - frontAngle) : frontAngle;
        switch (unit) {
            case 'rad': return angleRad;
            case 'deg': return angleRad * 180 / Math.PI;
            case 'tanθ': return slope;
            default: return angleRad * 180 / Math.PI;
        }
    }

    const heightPixel = focalLengthPx * slope;
    const pixelPitchUm = isFinite(pixelSizeUm) && pixelSizeUm > 0 ? pixelSizeUm : 1;
    const heightUm = heightPixel * pixelPitchUm;
    switch (unit) {
        case 'pixel': return heightPixel;
        case 'um': return heightUm;
        case 'mm': return heightUm / 1e3;
        case 'cm': return heightUm / 1e4;
        case 'm': return heightUm / 1e6;
        default: return heightUm / 1e6;
    }
}

const unitKind = { deg: 'angle', rad: 'angle', 'tanθ': 'angle', pixel: 'height', um: 'height', mm: 'height', cm: 'height', m: 'height' };

function getCurveAxisTitle(axisKey) {
    const unit = curveAxes[axisKey].state.unit || 'deg';
    const kind = unitKind[unit] || 'height';

    const axisTitles = {
        x: { angle: 'incoming ray', height: 'reference height' },
        y: { angle: 'reflected ray', height: 'measured height' }
    };

    return `${axisTitles[axisKey][kind]} (${unit})`;
}

function bindCurveAxisControls(axisKey) {
    const axis = curveAxes[axisKey];
    axis.unitOptions.forEach(option => {
        option.addEventListener('change', function () {
            axis.state.unit = this.value;
            refreshCurveChart();
        });
    });
}

function setCurveDirectionAngle(deg) {
    if (!isFinite(deg)) deg = 0;
    let rad = deg * Math.PI / 180;
    deg = Math.atan2(Math.sin(rad), Math.cos(rad)) * 180 / Math.PI;
    curveDirectionAngleSlider.value = deg;
    curveDirectionAngleText.value = deg;
    refreshCurveChart();
}

function setCurveDirectionFromPreset(target) {
    const [, iw, ih, , , cx, cy] = getIntrinsics();
    if (!isFinite(iw) || !isFinite(ih) || !isFinite(cx) || !isFinite(cy)) return;

    const targets = {
        T: [cx, 0], TR: [iw, 0], R: [iw, cy], BR: [iw, ih], B: [cx, ih],
        BL: [0, ih], L: [0, cy], TL: [0, 0]
    };

    const targetPoint = targets[target];
    if (!targetPoint) return;

    const [targetU, targetV] = targetPoint;
    const deltaU = targetU - cx;
    const deltaV = targetV - cy;
    if (Math.abs(deltaU) < 1e-12 && Math.abs(deltaV) < 1e-12) return;

    const angleDeg = Math.atan2(-deltaV, deltaU) * 180 / Math.PI;
    setCurveDirectionAngle(angleDeg);
}

function getCurveDirectionUnitVector() {
    const directionDeg = parseFloat(curveDirectionAngleSlider.value);
    const directionRad = directionDeg * Math.PI / 180;
    const dirX = Math.cos(directionRad);
    const dirY = -Math.sin(directionRad);
    const norm = Math.hypot(dirX, dirY) || 1;
    return [dirX / norm, dirY / norm];
}

function renderDirectionCanvas() {
    const [, iw, ih, , , cx, cy] = getIntrinsics();
    if (!isFinite(iw) || !isFinite(ih) || iw <= 0 || ih <= 0) {
        directionCanvas.width = DIRECTION_CANVAS_MAX_WIDTH;
        directionCanvas.height = DIRECTION_CANVAS_MAX_HEIGHT;
        directionCanvas.style.width = `${DIRECTION_CANVAS_MAX_WIDTH}px`;
        directionCanvas.style.height = `${DIRECTION_CANVAS_MAX_HEIGHT}px`;
    } else {
        const scale = Math.min(DIRECTION_CANVAS_MAX_WIDTH / iw, DIRECTION_CANVAS_MAX_HEIGHT / ih, 1);
        const displayWidth = Math.max(1, Math.round(iw * scale));
        const displayHeight = Math.max(1, Math.round(ih * scale));
        directionCanvas.width = displayWidth;
        directionCanvas.height = displayHeight;
        directionCanvas.style.width = `${displayWidth}px`;
        directionCanvas.style.height = `${displayHeight}px`;
    }

    const width = directionCanvas.width;
    const height = directionCanvas.height;
    directionCtx.clearRect(0, 0, width, height);
    directionCtx.fillStyle = '#ffffff';
    directionCtx.fillRect(0, 0, width, height);

    directionCtx.strokeStyle = '#000000';
    directionCtx.lineWidth = 1;
    directionCtx.strokeRect(0.5, 0.5, width - 1, height - 1);

    const scaleX = width / iw;
    const scaleY = height / ih;
    const centerX = cx * scaleX;
    const centerY = cy * scaleY;

    directionCtx.strokeStyle = '#bbbbbb';
    directionCtx.beginPath();
    directionCtx.moveTo(0, centerY + 0.5);
    directionCtx.lineTo(width, centerY + 0.5);
    directionCtx.moveTo(centerX + 0.5, 0);
    directionCtx.lineTo(centerX + 0.5, height);
    directionCtx.stroke();

    directionCtx.fillStyle = '#0b63f6';
    directionCtx.beginPath();
    directionCtx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
    directionCtx.fill();

    const [dirX, dirY] = getCurveDirectionUnitVector();
    const fovLimitRad = findFovLimit(dirX, dirY);
    const rayZ = fovLimitRad > Math.PI * 0.5 ? -1 : 1;
    const incomingSlope = Math.tan(rayZ > 0 ? fovLimitRad : (Math.PI - fovLimitRad));
    const xu = dirX * incomingSlope;
    const yu = dirY * incomingSlope;
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [ , , , fx, fy, cx_, cy_ ] = getIntrinsics();
    const [xDist, yDist] = applyDistortion(xu, yu, rayZ, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    const u = fx * xDist + cx_;
    const v = fy * yDist + cy_;
    let arrowDistance = Math.hypot(u - cx_, v - cy_);
    arrowDistance *= scaleX;

    const endX = centerX + dirX * arrowDistance;
    const endY = centerY + dirY * arrowDistance;

    directionCtx.strokeStyle = '#0b63f6';
    directionCtx.lineWidth = 2;
    directionCtx.beginPath();
    directionCtx.moveTo(centerX, centerY);
    directionCtx.lineTo(endX, endY);
    directionCtx.stroke();

    const headLength = 6;
    const angle = Math.atan2(endY - centerY, endX - centerX);
    directionCtx.beginPath();
    directionCtx.moveTo(endX, endY);
    directionCtx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
    directionCtx.moveTo(endX, endY);
    directionCtx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
    directionCtx.stroke();
}

function initCurveChart() {
    curveCanvas._curveChart = new Chart(curveCtx, {
        type: 'line',
        plugins: [{
            id: 'topRightPlotBorder',
            afterDraw(chart) {
                const { ctx, chartArea } = chart;
                if (!chartArea) return;
                ctx.save();
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(chartArea.left, chartArea.top + 0.5);
                ctx.lineTo(chartArea.right, chartArea.top + 0.5);
                ctx.moveTo(chartArea.right - 0.5, chartArea.top);
                ctx.lineTo(chartArea.right - 0.5, chartArea.bottom);
                ctx.stroke();
                ctx.restore();
            }
        }],
        data: {
            datasets: [{
                label: 'y',
                data: [],
                borderColor: '#0b63f6',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0
            }, {
                label: 'y',
                data: [],
                borderColor: '#0b63f6',
                backgroundColor: '#0b63f6',
                pointRadius: 4,
                pointHoverRadius: 4,
                showLine: false
            }]
        },
        options: {
            animation: false,
            responsive: false,
            maintainAspectRatio: false,
            layout: {
                padding: { left: 6, right: 6, top: 6, bottom: 2 }
            },
            plugins: { legend: { display: false } },
            scales: {
                x: { type: 'linear', title: { display: true, text: getCurveAxisTitle('x'), color: '#000000' }, border: { color: '#000000', width: 1 }, grid: { color: '#b0b0b0', drawTicks: true, tickLength: -4 }, ticks: { color: '#000000', maxTicksLimit: 16, includeBounds: false, padding: 8 } },
                y: { type: 'linear', title: { display: true, text: getCurveAxisTitle('y'), color: '#000000' }, border: { color: '#000000', width: 1 }, grid: { color: '#b0b0b0', drawTicks: true, tickLength: -4 }, ticks: { color: '#000000', maxTicksLimit: 12, includeBounds: false, padding: 8 } }
            }
        }
    });
}

function updateFovResults() {
    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    // Horizontal FOV: left (-X) and right (+X)
    const h1 = findFovLimit(-1, 0);
    const h2 = findFovLimit(1, 0);
    const hFOV = (h1 + h2) * 180 / Math.PI;
    // Vertical FOV: up (-Y) and down (+Y)
    const v1 = findFovLimit(0, -1);
    const v2 = findFovLimit(0, 1);
    const vFOV = (v1 + v2) * 180 / Math.PI;
    // Diagonal FOV: four corners
    const d1 = findFovLimit(iw, ih) + findFovLimit(-iw, -ih);
    const d2 = findFovLimit(-iw, ih) + findFovLimit(iw, -ih);
    const dFOV = Math.min(d1, d2) * 180 / Math.PI;
    document.getElementById('hFOVResult').textContent = hFOV.toFixed(1);
    document.getElementById('vFOVResult').textContent = vFOV.toFixed(1);
    document.getElementById('dFOVResult').textContent = dFOV.toFixed(1);
}

function refreshCurveChart() {
    const curveChart = curveCanvas._curveChart;
    if (!curveChart) return;

    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const incomingStepDeg = 0.1;
    const incomingStepRad = incomingStepDeg * Math.PI / 180;
    const [rayDirX, rayDirY] = getCurveDirectionUnitVector();

    const fovLimitRad = findFovLimit(rayDirX, rayDirY, incomingStepDeg);
    const extraRad = 10 * Math.PI / 180;
    const maxAngleRad = Math.min(fovLimitRad + extraRad, Math.PI - 1e-6);

    const points = [];
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    let fovPoint = null;

    for (let angle = 0; angle <= maxAngleRad + 1e-8; angle += incomingStepRad) {
        const rayZ = angle > Math.PI * 0.5 ? -1 : 1;
        const incomingSlope = Math.tan(rayZ > 0 ? angle : (Math.PI - angle));
        const xu = rayDirX * incomingSlope;
        const yu = rayDirY * incomingSlope;
        const [xDist, yDist] = applyDistortion(xu, yu, rayZ, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        const u = fx * xDist + cx;
        const v = fy * yDist + cy;
        const inResolution = u >= 0 && u <= iw && v >= 0 && v <= ih;
        if (!inResolution) break;
        const xValue = getCurveAxisValue('x', incomingSlope, rayZ, fx, pixelSizeUm);
        const yValue = getCurveAxisValue('y', Math.hypot(xDist, yDist), rayZ, fy, pixelSizeUm);
        if (!isFinite(xValue) || !isFinite(yValue)) continue;
        points.push({ x: xValue, y: yValue });
        xMin = Math.min(xMin, xValue); xMax = Math.max(xMax, xValue);
        yMin = Math.min(yMin, yValue); yMax = Math.max(yMax, yValue);
        if (!fovPoint && angle + 1e-8 >= fovLimitRad) fovPoint = { x: xValue, y: yValue };
    }

    xMin = isFinite(xMin) ? xMin : 0; xMax = isFinite(xMax) ? xMax : 1;
    yMin = isFinite(yMin) ? yMin : 0; yMax = isFinite(yMax) ? yMax : 1;
    const xPad = (xMax - xMin) * 0.05 || 0.05;
    const yPad = (yMax - yMin) * 0.1 || 0.1;

    curveChart.data.datasets[0].data = points;
    curveChart.data.datasets[1].data = fovPoint ? [fovPoint] : [];
    curveChart.options.scales.x.min = xMin - xPad;
    curveChart.options.scales.x.max = xMax + xPad;
    curveChart.options.scales.y.min = yMin - yPad;
    curveChart.options.scales.y.max = yMax + yPad;
    curveChart.options.scales.x.title.text = getCurveAxisTitle('x');
    curveChart.options.scales.y.title.text = getCurveAxisTitle('y');
    curveChart.update('none');

    renderDirectionCanvas();
}

function updateValuesFromSlider(id) {
    const slider = document.getElementById(id);
    const textBox = document.getElementById(id + 'Text');
    if (textBox) textBox.value = slider.value;
    updateParameter(id, parseFloat(slider.value));
}

function updateValuesFromTextBox(id) {
    const textBox = document.getElementById(id + 'Text');
    const slider = document.getElementById(id);
    if (slider) slider.value = textBox.value;
    updateParameter(id, parseFloat(textBox.value));
}

function syncExtrinsicsFromWorldToCamera() {
    const [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);
    [rx_cw, ry_cw, rz_cw] = rotationMatrixToEulerAngles(R11, R21, R31, R12, R22, R32, R13, R23, R33);
    tx_cw = -(R11 * tx_wc + R21 * ty_wc + R31 * tz_wc);
    ty_cw = -(R12 * tx_wc + R22 * ty_wc + R32 * tz_wc);
    tz_cw = -(R13 * tx_wc + R23 * ty_wc + R33 * tz_wc);
}

function syncExtrinsicsFromCameraToWorld() {
    const [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_cw, ry_cw, rz_cw);
    [rx_wc, ry_wc, rz_wc] = rotationMatrixToEulerAngles(R11, R21, R31, R12, R22, R32, R13, R23, R33);
    tx_wc = -(R11 * tx_cw + R21 * ty_cw + R31 * tz_cw);
    ty_wc = -(R12 * tx_cw + R22 * ty_cw + R32 * tz_cw);
    tz_wc = -(R13 * tx_cw + R23 * ty_cw + R33 * tz_cw);
}

function updateExtrinsicControls() {
    if (world2camBtn.classList.contains('active')) {
        document.getElementById('rx').value = rx_wc * 180 / Math.PI;
        document.getElementById('ry').value = ry_wc * 180 / Math.PI;
        document.getElementById('rz').value = rz_wc * 180 / Math.PI;
        document.getElementById('tx').value = tx_wc;
        document.getElementById('ty').value = ty_wc;
        document.getElementById('tz').value = tz_wc;
        document.getElementById('rxText').value = rx_wc * 180 / Math.PI;
        document.getElementById('ryText').value = ry_wc * 180 / Math.PI;
        document.getElementById('rzText').value = rz_wc * 180 / Math.PI;
        document.getElementById('txText').value = tx_wc;
        document.getElementById('tyText').value = ty_wc;
        document.getElementById('tzText').value = tz_wc;
    } else {
        document.getElementById('rx').value = rx_cw * 180 / Math.PI;
        document.getElementById('ry').value = ry_cw * 180 / Math.PI;
        document.getElementById('rz').value = rz_cw * 180 / Math.PI;
        document.getElementById('tx').value = tx_cw;
        document.getElementById('ty').value = ty_cw;
        document.getElementById('tz').value = tz_cw;
        document.getElementById('rxText').value = rx_cw * 180 / Math.PI;
        document.getElementById('ryText').value = ry_cw * 180 / Math.PI;
        document.getElementById('rzText').value = rz_cw * 180 / Math.PI;
        document.getElementById('txText').value = tx_cw;
        document.getElementById('tyText').value = ty_cw;
        document.getElementById('tzText').value = tz_cw;
    }
}

function updateParameter(id, value) {
    switch (id) {
        case 'iw':
            updateImageDimension('iw');
            chessCanvas._undistortTable = null;
            break;
        case 'ih':
            updateImageDimension('ih');
            chessCanvas._undistortTable = null;
            break;
        case 'fx': case 'fy': case 'cx': case 'cy':
        case 'k1': case 'k2': case 'p1': case 'p2': case 'k3': case 'k4': case 'k5': case 'k6':
            chessCanvas._undistortTable = null;
            break;
        case 'rx':
            if (world2camBtn.classList.contains('active')) rx_wc = value * Math.PI / 180;
            else rx_cw = value * Math.PI / 180;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera(); else syncExtrinsicsFromCameraToWorld();
            break;
        case 'ry':
            if (world2camBtn.classList.contains('active')) ry_wc = value * Math.PI / 180;
            else ry_cw = value * Math.PI / 180;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera(); else syncExtrinsicsFromCameraToWorld();
            break;
        case 'rz':
            if (world2camBtn.classList.contains('active')) rz_wc = value * Math.PI / 180;
            else rz_cw = value * Math.PI / 180;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera(); else syncExtrinsicsFromCameraToWorld();
            break;
        case 'tx':
            if (world2camBtn.classList.contains('active')) tx_wc = value;
            else tx_cw = value;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera(); else syncExtrinsicsFromCameraToWorld();
            break;
        case 'ty':
            if (world2camBtn.classList.contains('active')) ty_wc = value;
            else ty_cw = value;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera(); else syncExtrinsicsFromCameraToWorld();
            break;
        case 'tz':
            if (world2camBtn.classList.contains('active')) tz_wc = value;
            else tz_cw = value;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera(); else syncExtrinsicsFromCameraToWorld();
            break;
        default:
            break;
    }

    if (viewChessboardBtn.classList.contains('active')) {
        renderChessboard();
    } else {
        refreshCurveChart();
    }
    updateFovResults();
}

function updateImageDimension(changedId) {
    const [, iw, ih] = getIntrinsics();

    if (changedId === 'iw') {
        const cx = iw / 2;
        document.getElementById('cx').max = iw;
        document.getElementById('cx').value = cx;
        document.getElementById('cxText').value = cx;
    } else {
        const cy = ih / 2;
        document.getElementById('cy').max = ih;
        document.getElementById('cy').value = cy;
        document.getElementById('cyText').value = cy;
    }

    chessCanvas.height = ih * chessCanvas.width / iw;
}

// Tab mode handlers
if (paramTab && tableTab) {
    paramTab.addEventListener('click', () => setParamTableMode('param'));
    tableTab.addEventListener('click', () => setParamTableMode('table'));
}

setParamTableMode('param');

// Intrinsics
// ps has only text input, no range slider.
const psTextInput = document.getElementById('psText');
if (psTextInput) {
    psTextInput.addEventListener('input', () => updateValuesFromTextBox('ps'));
}

['iw', 'ih', 'fx', 'fy', 'cx', 'cy'].forEach(id => {
    const slider = document.getElementById(id);
    const textbox = document.getElementById(`${id}Text`);
    if (slider) {
        slider.addEventListener('input', () => updateValuesFromSlider(id));
    }
    if (textbox) {
        textbox.addEventListener('input', () => updateValuesFromTextBox(id));
    }
});

// Distortion
['k1', 'k2', 'p1', 'p2', 'k3', 'k4', 'k5', 'k6'].forEach(id => {
    document.getElementById(`${id}`).addEventListener('input', () => updateValuesFromSlider(id));
    document.getElementById(`${id}Text`).addEventListener('input', () => updateValuesFromTextBox(id));
});

document.getElementById('fisheye').addEventListener('input', () => {
    chessCanvas._undistortTable = null;
    if (viewChessboardBtn.classList.contains('active')) renderChessboard(); else refreshCurveChart();
    updateFovResults();
});

// Extrinsic
['rx', 'ry', 'rz', 'tx', 'ty', 'tz'].forEach(id => {
    document.getElementById(`${id}`).addEventListener('input', () => updateValuesFromSlider(id));
    document.getElementById(`${id}Text`).addEventListener('input', () => updateValuesFromTextBox(id));
});

world2camBtn.addEventListener('click', () => { updateExtrinsicModeButtons('world2cam'); updateExtrinsicControls(); });
cam2worldBtn.addEventListener('click', () => { updateExtrinsicModeButtons('cam2world'); updateExtrinsicControls(); });

// Chessboard
['bc', 'br', 'bw', 'bh'].forEach(id => {
    document.getElementById(`${id}`).addEventListener('input', () => updateValuesFromSlider(id));
    document.getElementById(`${id}Text`).addEventListener('input', () => updateValuesFromTextBox(id));
});

function switchChessboardOrigin(targetMode) {
    const isCenterNow = centerAtCTBtn.classList.contains('active');
    const targetCenter = targetMode === 'center';
    if (isCenterNow === targetCenter) return;

    const [bc, br, bw, bh] = getChessboardSettings();
    const previousCenter = isCenterNow;
    const halfbw = ((bc - 1) / 2) * bw;
    const halfbh = ((br - 1) / 2) * bh;
    const sign = previousCenter ? 1 : -1;
    const delta = [sign * halfbw, sign * halfbh, 0];

    const [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);
    const tdx = -(R11 * delta[0] + R12 * delta[1] + R13 * delta[2]);
    const tdy = -(R21 * delta[0] + R22 * delta[1] + R23 * delta[2]);
    const tdz = -(R31 * delta[0] + R32 * delta[1] + R33 * delta[2]);

    tx_wc += tdx; ty_wc += tdy; tz_wc += tdz;

    updateChessboardOriginTabs(targetMode);
    syncExtrinsicsFromWorldToCamera();
    updateExtrinsicControls();
    if (viewChessboardBtn.classList.contains('active')) renderChessboard();
}

centerAtTLBtn.addEventListener('click', () => switchChessboardOrigin('tl'));
centerAtCTBtn.addEventListener('click', () => switchChessboardOrigin('center'));

document.getElementById('showSquares').addEventListener('input', () => {
    if (viewChessboardBtn.classList.contains('active')) renderChessboard();
});

document.getElementById('showCircles').addEventListener('input', () => {
    if (viewChessboardBtn.classList.contains('active')) renderChessboard();
});

viewChessboardBtn.addEventListener('click', () => {
    toggleChessUI(true);
    toggleCurveUI(false);
    renderChessboard();
    updateFovResults();
});

viewCurveBtn.addEventListener('click', () => {
    toggleChessUI(false);
    toggleCurveUI(true);
    refreshCurveChart();
    updateFovResults();
});

setupCurveAxisUI();

bindCurveAxisControls('x');
bindCurveAxisControls('y');

curveDirectionAngleSlider.addEventListener('input', function () {
    curveDirectionAngleText.value = this.value;
    refreshCurveChart();
});
curveDirectionAngleText.addEventListener('input', function () { setCurveDirectionAngle(parseFloat(this.value)); });

// Reset
document.getElementById('reset').addEventListener('click', () => location.reload());

// init
initCurveChart();
toggleChessUI(true);
toggleCurveUI(false);
updateExtrinsicModeButtons('world2cam');
updateChessboardOriginTabs('center');
setCurveDirectionAngle(parseFloat(curveDirectionAngleSlider.value));

renderChessboard();
updateFovResults();
