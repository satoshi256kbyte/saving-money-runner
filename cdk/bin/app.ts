import * as cdk from 'aws-cdk-lib';

import { FoundationStack } from '../lib/foundation-stack.js';

const app = new cdk.App();
new FoundationStack(app, 'FoundationStack');
