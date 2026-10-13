import contextlib
import io
import json
import os
import pathlib
import re
import subprocess
import tempfile
import textwrap
import types
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / '.github/workflows/deploy-beamup.yml').read_text()
BLOCKS = [textwrap.dedent(code) for code in re.findall(
    r"^          python3 - <<'PY'\n(.*?)^          PY$", WORKFLOW, re.M | re.S
)]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
URL = 'https://example.baby-beamup.club'


class BeamupWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env_file = pathlib.Path(self.directory.name) / 'env'
        self.summary = pathlib.Path(self.directory.name) / 'summary'
        self.environment = {
            'GITHUB_REPOSITORY_OWNER': 'Example',
            'BEAMUP_PROJECT': 'aiolivetv',
            'BEAMUP_HOST': 'a.baby-beamup.club',
            'BEAMUP_URL': URL,
            'RUNNER_TEMP': self.directory.name,
            'GITHUB_ENV': str(self.env_file),
            'GITHUB_STEP_SUMMARY': str(self.summary),
            'GITHUB_RUN_ID': '123',
            'GITHUB_RUN_ATTEMPT': '2',
            'BEAMUP_EXPECTED_VERSION': VERSION,
            'BEAMUP_DEPLOY_STARTED_AT': '2026-10-13T12:00:00+00:00',
        }
        self.config = {
            'BASE_URL': URL,
            'SECRET_KEY': 'hidden secret with spaces, quotes " and $',
            'DATABASE_URI': 'postgres://hidden:password@db/database',
            'AIOLIVETV_AUTH': 'hidden:password',
        }

    def execute(self, block, run):
        output = io.StringIO()
        with patch.dict(os.environ, self.environment), \
                patch('subprocess.run', side_effect=run), \
                patch('time.sleep'), contextlib.redirect_stdout(output):
            exec(compile(BLOCKS[block], 'deploy-beamup.yml', 'exec'), {})
        return output.getvalue()

    def read_config(self, command, **kwargs):
        self.assertEqual(command[0], 'ssh')
        self.assertEqual(command[-3], 'config:get')
        return types.SimpleNamespace(
            returncode=0, stdout=(self.config[command[-1]] + '\n').encode()
        )

    def response(self, command, **kwargs):
        self.assertEqual(command[0], 'curl')
        self.assertIn('Cache-Control: no-cache', command)
        self.assertIn('?deploy=123-2', command[-1])
        payload = {'success': True}
        if '/status?' in command[-1]:
            payload['data'] = {
                'version': VERSION, 'settings': {'baseUrl': URL},
                'buildTime': '2026-10-13T12:01:00Z',
            }
        return types.SimpleNamespace(
            returncode=0, stdout=json.dumps(payload).encode() + b'\n200'
        )

    def test_config_is_validated_without_writing_or_logging_secrets(self):
        output = self.execute(0, self.read_config)
        self.assertTrue(self.env_file.read_text().startswith('BEAMUP_EXPECTED_VERSION=' + VERSION + '\nBEAMUP_DEPLOY_STARTED_AT='))
        for name in self.config:
            self.assertIn(name + ': configured (value hidden)', output)
        self.assertNotIn(self.config['SECRET_KEY'], output)
        self.assertNotIn('beamup-runtime.json', WORKFLOW)
        self.assertNotIn('beamup-env.cjs', WORKFLOW)
        self.assertNotIn('git commit', WORKFLOW)

    def test_invalid_config_aborts_before_deploy(self):
        for value in ['', 'two\nlines', 'two\rlines', '\x00', 'ERR unavailable']:
            with self.subTest(value=value):
                self.config['SECRET_KEY'] = value
                with self.assertRaises(SystemExit):
                    self.execute(0, self.read_config)
                self.assertFalse(self.env_file.exists())

    def test_wrong_base_url_and_ssh_failure_abort(self):
        self.config['BASE_URL'] = 'https://wrong.example'
        with self.assertRaisesRegex(SystemExit, 'BASE_URL does not match'):
            self.execute(0, self.read_config)
        with self.assertRaisesRegex(SystemExit, 'Could not read BASE_URL'):
            self.execute(0, lambda *args, **kwargs: types.SimpleNamespace(returncode=1))

    def test_expected_version_and_healthy_database_pass(self):
        self.execute(1, self.response)
        self.assertIn('database connectivity', self.summary.read_text())

    def test_old_version_wrong_base_url_or_bad_health_fail(self):
        for case in ['old-version', 'wrong-url', 'bad-health', 'null-url', 'old-build', 'invalid-build']:
            with self.subTest(case=case):
                def run(command, **kwargs):
                    result = self.response(command, **kwargs)
                    payload = json.loads(result.stdout.rsplit(b'\n', 1)[0])
                    if '/status?' in command[-1]:
                        if case == 'old-version':
                            payload['data']['version'] = 'old'
                        elif case == 'wrong-url':
                            payload['data']['settings']['baseUrl'] = 'https://wrong.example'
                        elif case == 'null-url':
                            payload['data']['settings']['baseUrl'] = None
                        elif case == 'old-build':
                            payload['data']['buildTime'] = '2026-10-12T12:00:00Z'
                        elif case == 'invalid-build':
                            payload['data']['buildTime'] = None
                    elif case == 'bad-health':
                        payload['success'] = False
                    result.stdout = json.dumps(payload).encode() + b'\n200'
                    return result

                with self.assertRaisesRegex(SystemExit, 'verification failed'):
                    self.execute(1, run)
                self.assertFalse(self.summary.exists())

    def test_transient_timeout_is_retried(self):
        calls = 0

        def run(command, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise subprocess.TimeoutExpired(command, 20)
            return self.response(command, **kwargs)

        output = self.execute(1, run)
        self.assertIn('request timed out', output)
        self.assertEqual(calls, 4)
        self.assertTrue(self.summary.exists())

    def test_invalid_http_or_json_response_is_rejected(self):
        for body in [b'secret error\n503', b'invalid secret JSON\n200', b'[]\n200']:
            with self.subTest(body=body):
                with self.assertRaisesRegex(SystemExit, 'verification failed') as error:
                    self.execute(1, lambda *args, **kwargs: types.SimpleNamespace(returncode=0, stdout=body))
                self.assertNotIn('secret', str(error.exception).split('Response bodies')[0])


if __name__ == '__main__':
    unittest.main()
