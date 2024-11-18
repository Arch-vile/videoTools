import {promises as fs} from 'fs';
import {parseString} from 'xml2js';
import {Jimp} from 'jimp';
import {exec as execCallback} from 'child_process';
import {promisify} from "node:util";
import path from "node:path";

const day1large = {
    mapFile: 'map-large-with-route.png',
    topLeftCoord: {lat: 68.62030295914282, lon: 24.00019949046651},
    bottomRightCoord: {lat: 68.45416897212543, lon: 24.876868951986832},
    trackFile: 'track-day1.gpx',
    dotDistanceInMeters: 50,
    dotSize: 5,
    bouncingBoxOfCorrectRouteMapped: {
        width: 370,
        height: 2037,
        topLeftX: 7244,
        topLeftY: 1571,
    }
}

async function main(conf: Config) {
    const imagePath = conf.mapFile
    const gpxFilePath = conf.trackFile;

    const topLeftCoord: Coordinate = conf.topLeftCoord;
    const bottomRightCoord: Coordinate = conf.bottomRightCoord;

    // Load image
    const image = await Jimp.read('./inputFiles/'+imagePath)
    const {bitmap} = image;
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;

    // Read GPX data
    const trackPoints = await parseGpxFile('./inputFiles/'+gpxFilePath)

    // Generate interpolated points
    const interpolatedPoints = generateInterpolatedPoints(
        trackPoints,
        conf.dotDistanceInMeters
    );

    // Map points to pixels
    const pixelPoints = interpolatedPoints.map((coord) =>
        mapGpxPointsToPixels(
            coord,
            topLeftCoord,
            bottomRightCoord,
            imageWidth,
            imageHeight,
        )
    );
    const adjusted = adjustPointsInsideBouncingBox(conf, pixelPoints);

    // Create animation frames
    await clearOldGeneratedFiles();
    await createAnimationFrames(
        conf.mapFile,
        adjusted.slice(0, 30),
        conf.dotSize,
    );
}

function adjustPointsInsideBouncingBox(conf: Config, pixelPoints: { x: number; y: number }[]) {
    const bouncingBoxOfCorrectRouteMapped = conf.bouncingBoxOfCorrectRouteMapped;

    // Size of the bouncing box of the points
    const xValues = pixelPoints.map(({x}) => x);
    const yValues = pixelPoints.map(({y}) => y);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const boxWidth = xMax - xMin;
    const boxHeight = yMax - yMin;

    const xScale = bouncingBoxOfCorrectRouteMapped.width / boxWidth;
    const yScale = bouncingBoxOfCorrectRouteMapped.height / boxHeight;
    const xOffset = bouncingBoxOfCorrectRouteMapped.topLeftX;
    const yOffset = bouncingBoxOfCorrectRouteMapped.topLeftY;

    const adjusted = pixelPoints.map(({x, y}) => {
        return {
            x: xOffset + (x - xMin) * xScale,
            y: yOffset + (y - yMin) * yScale,
        }
    });
    return adjusted;
}

async function parseGpxFile(filePath: string): Promise<Coordinate[]> {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const result = await parseXml<GpxFile>(data);

        const GpxPoints: Coordinate[] = [];
        const tracks = result.gpx.trk;

        // Extract GpxPoints from <trkpt> elements
        for (const track of tracks) {
            for (const segment of track.trkseg) {
                for (const point of segment.trkpt) {
                    const lat = parseFloat(point.$.lat);
                    const lon = parseFloat(point.$.lon);
                    GpxPoints.push({lat, lon});
                }
            }
        }

        return GpxPoints;
    } catch (error) {
        throw new Error(`Error parsing GPX file: ${error}`);
    }
}

// Helper function to parse XML into a JavaScript object
function parseXml<T>(xml: string): Promise<T> {
    return new Promise((resolve, reject) => {
        parseString(xml, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}


// Function to rotate a point around a center point
const rotatePoint = (
    x: number,
    y: number,
    centerX: number,
    centerY: number,
    theta: number,
): { x: number; y: number } => {
    const dx = x - centerX;
    const dy = y - centerY;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const xRot = dx * cosTheta - dy * sinTheta + centerX;
    const yRot = dx * sinTheta + dy * cosTheta + centerY;
    return {x: xRot, y: yRot};
};

/**
 * Converts a GPS coordinate to pixel coordinates on an image using the Web Mercator projection and rotation.
 * @param coord - The GPS coordinate to convert.
 * @param topLeft - The GPS coordinate of the image's top-left corner.
 * @param bottomRight - The GPS coordinate of the image's bottom-right corner.
 * @param imageWidth - The width of the image in pixels.
 * @param imageHeight - The height of the image in pixels.
 * @param rotationAngle - The rotation angle of the map in degrees (clockwise).
 * @returns The pixel coordinates corresponding to the GPS coordinate.
 */
function mapGpxPointsToPixels(
    coord: Coordinate,
    topLeft: Coordinate,
    bottomRight: Coordinate,
    imageWidth: number,
    imageHeight: number,
): { x: number; y: number } {

    const rotationAngle: number = 2.38;
    // Earth's radius in meters (for Web Mercator projection)
    const R = 6378137;

    // Convert degrees to radians
    const degToRad = (deg: number) => (deg * Math.PI) / 180;

    // Function to convert latitude and longitude to Web Mercator x and y
    const latLonToMercator = (lat: number, lon: number) => {
        const x = R * degToRad(lon);
        const y = R * Math.log(Math.tan(Math.PI / 4 + degToRad(lat) / 2));
        return {x, y};
    };

    // Convert the input coordinates to Mercator projection
    const pointMerc = latLonToMercator(coord.lat, coord.lon);
    const topLeftMerc = latLonToMercator(topLeft.lat, topLeft.lon);
    const bottomRightMerc = latLonToMercator(bottomRight.lat, bottomRight.lon);

    // Compute the center of the map in Mercator coordinates
    const centerX = (topLeftMerc.x + bottomRightMerc.x) / 2;
    const centerY = (topLeftMerc.y + bottomRightMerc.y) / 2;

    // Convert rotation angle to radians (counter-clockwise rotation)
    const theta = degToRad(-rotationAngle); // Negative for clockwise rotation

    // Define the four corners in Mercator coordinates
    const topRightMerc = {x: bottomRightMerc.x, y: topLeftMerc.y};
    const bottomLeftMerc = {x: topLeftMerc.x, y: bottomRightMerc.y};

    // Rotate all four corners around the center
    const rotatedTopLeft = rotatePoint(topLeftMerc.x, topLeftMerc.y, centerX, centerY, theta);
    const rotatedTopRight = rotatePoint(topRightMerc.x, topRightMerc.y, centerX, centerY, theta);
    const rotatedBottomLeft = rotatePoint(bottomLeftMerc.x, bottomLeftMerc.y, centerX, centerY, theta);
    const rotatedBottomRight = rotatePoint(
        bottomRightMerc.x,
        bottomRightMerc.y,
        centerX,
        centerY,
        theta,
    );

    // Compute the bounding box of the rotated corners
    const xValues = [
        rotatedTopLeft.x,
        rotatedTopRight.x,
        rotatedBottomLeft.x,
        rotatedBottomRight.x,
    ];
    const yValues = [
        rotatedTopLeft.y,
        rotatedTopRight.y,
        rotatedBottomLeft.y,
        rotatedBottomRight.y,
    ];

    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);

    // Rotate the point
    const rotatedPoint = rotatePoint(pointMerc.x, pointMerc.y, centerX, centerY, theta);

    // Calculate the scale factors
    const scaleX = imageWidth / (xMax - xMin);
    const scaleY = imageHeight / (yMax - yMin);

    // Calculate the pixel coordinates
    const x = (rotatedPoint.x - xMin) * scaleX * 1.03;
    const y = (yMax - rotatedPoint.y) * scaleY * 1.015; // Invert y-axis

    return {x, y};
}

function latToMercatorY(lat: number): number {
    const radLat = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + radLat / 2));
}

function haversineDistance(coord1: Coordinate, coord2: Coordinate): number {
    const R = 6371e3; // Earth radius in meters
    const toRad = (value: number) => (value * Math.PI) / 180;

    const toRad1 = toRad(coord1.lat);
    const toRad2 = toRad(coord2.lat);
    const radDifLat = toRad(coord2.lat - coord1.lat);
    const radDifLon = toRad(coord2.lon - coord1.lon);

    const a =
        Math.sin(radDifLat / 2) ** 2 +
        Math.cos(toRad1) * Math.cos(toRad2) * Math.sin(radDifLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
}

function generateInterpolatedPoints(
    trackPoints: Coordinate[],
    intervalDistance: number
): Coordinate[] {
    const interpolatedPoints: Coordinate[] = [];

    let accumulatedDistance = 0;
    interpolatedPoints.push(trackPoints[0]);

    for (let i = 1; i < trackPoints.length; i++) {
        const currentPoint = trackPoints[i];
        const previousPoint = interpolatedPoints[interpolatedPoints.length - 1];
        const segmentDistance = haversineDistance(previousPoint, currentPoint);
        if (segmentDistance >= intervalDistance) {
            interpolatedPoints.push(currentPoint);
        }
    }

    interpolatedPoints.push(trackPoints[trackPoints.length - 1]);

    return interpolatedPoints;
}

function computeGeographicAspectRatio(
    topLeft: Coordinate,
    bottomRight: Coordinate
): number {
    // Project coordinates using Mercator projection
    const xLeft = topLeft.lon;
    const xRight = bottomRight.lon;

    const yTop = latToMercatorY(topLeft.lat);
    const yBottom = latToMercatorY(bottomRight.lat);

    const deltaX = xRight - xLeft;
    const deltaY = yTop - yBottom;

    return deltaX / deltaY;
}


async function execCommand(command: string, directory: string): Promise<void> {
    const exec = promisify(execCallback);
    await exec(command, {cwd: directory});
}

const generateGifDir = './generated-gifs';

async function generateGifOnChildProcess(mapImage: string) {
    console.log('Generating animation...' + new Date().toISOString());
    const animatedGifPath = path.join(generateGifDir, 'animated.gif');

    // Step 1: Copy background.png as animated.gif to destination folder
    await fs.copyFile(mapImage, animatedGifPath);

    // Step 2: List the output files output*.png
    let files = await fs.readdir(generateGifDir);

    // Filter files matching output*.png
    files = files.filter(file => file.startsWith('output') && file.endsWith('.png'));

    // Exclude already processed files
    files = files.filter(file => !file.includes('-processed'));

    // Step 3: Process those in the alphabetic order
    files.sort();

    let previous = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const start = Date.now();
        console.log(`Processing file: ${file}`);
        const filePath = path.join(generateGifDir, file);

        // Step 4: Add the first file to animated.gif
        const tmpGifPath = path.join(generateGifDir, 'animated_tmp.gif');
        // const cmd = `magick convert ${animatedGifPath} ${filePath} ${tmpGifPath}`;
        const cmd = `magick -delay 20 -loop 1 ${animatedGifPath} ${filePath} ${tmpGifPath}`;

        await execCommand(cmd, '.');

        // Replace animated.gif with animated_tmp.gif
        await fs.rename(tmpGifPath, animatedGifPath);

        // Step 5: Rename the first file to output-processed
        const processedFileName = file.replace('.png', '-processed.png');
        const processedFilePath = path.join(generateGifDir, processedFileName);
        await fs.rename(filePath, processedFilePath);

        const timed = Date.now() - start;
        const increase = timed - previous;
        const base = timed - increase * (i + 1);

        const framesLeft = files.length - i - 1;
        const estimatedTimeLeft = framesLeft * base + increase * framesLeft * (framesLeft + 1) / 2;
        console.log(`Processed in ${formatMilliseconds((Date.now() - start))}. Estimated time left: ${formatMilliseconds(estimatedTimeLeft)}`);
        previous = timed;
    }

    console.log('Gif generation completed.');
}

function interpolateOrExtrapolateValue(x: number, values: number[]): number {
    const n = values.length;

    if (n < 2) {
        return values[0] * x;
    }

    if (x > n) {
        // Extrapolate above the last value
        const slope = (values[n - 1] - values[n - 2]) / (n - (n - 1));
        return values[n - 1] + (x - n) * slope;
    } else {
        // Interpolate within the array
        return values[x - 1];
    }
}

function formatMilliseconds(ms: number): string {
    if (ms < 0) {
        return "Milliseconds must be a non-negative number.";
    }

    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    const pad = (num: number) => num.toString().padStart(2, '0');

    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

async function clearOldGeneratedFiles() {
    await execCommand('mkdir -p outputFiles', '.');
    await execCommand('rm -f *', './outputFiles/');
}

async function createAnimationFrames(
    imagePath: string,
    points: { x: number; y: number }[],
    dotSize: number
) {
    const image = await Jimp.read('./inputFiles/'+imagePath);

    let imageIndex = 1;
    console.log(`Creating frames... ${points.length} frames to create`);
    for (let i = 0; i < points.length; i++) {
        const frame = image.clone();

        // Draw dots up to the current point
        for (let j = 0; j <= i; j++) {
            const point = points[j];
            drawCircle(frame, point.x, point.y, dotSize);
        }
        const fileName = `./outputFiles/output-${padwithZero(imageIndex, 5)}.png`
        await frame.write(fileName as any);
        imageIndex++;
        console.log(`Frame ${fileName} created`);
    }
}

function drawCircle(image: any, centerX: number, centerY: number, radius: number) {
    const color = 0x000000ff;

    // Draw the circle
    for (let y = centerY - radius; y <= centerY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            if (dx * dx + dy * dy <= radius * radius) {
                image.setPixelColor(color, x, y);
            }
        }
    }
}

function padwithZero(number: number, width: number): string {
    const str = number.toString();
    return str.length >= width ? str : new Array(width - str.length + 1).join('0') + str;
}

function degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

main(day1large).catch(console.error);


type Config = {
    mapFile: string
    topLeftCoord: Coordinate
    bottomRightCoord: Coordinate
    trackFile: string
    dotDistanceInMeters: number
    dotSize: number
    bouncingBoxOfCorrectRouteMapped: {
        width: number,
        height: number,
        topLeftX: number,
        topLeftY: number,
    }
}


// Define types for better type safety
interface Coordinate {
    lat: number;
    lon: number;
}

interface GpxFile {
    gpx: {
        trk: {
            trkseg: {
                trkpt: {
                    $: {
                        lat: string;
                        lon: string;
                    };
                }[];
            }[];
        }[];
    };
}
