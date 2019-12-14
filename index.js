// Checks API example
// See: https://developer.github.com/v3/checks/ to learn more
const Octokit = require("@octokit/rest");
const octokit = new Octokit();
var path = require('path')
var Git = require('nodegit')
var fs = require('fs')
var util = require('util')
const gprocess = require('process')
const cprocess = require('child_process')
var rimraf = require('rimraf')
const gdict = {}
//console.log(process.env.POSMON_PUB_KEY)

module.exports = app => {
  app.on(['check_suite.requested', 'check_suite.rerequested',
    'check_run.created',
    'check_suite.completed', 'check_run.completed',
    'pull_request.opened'], check)

  const APP_CHECK_NAME = 'PEP8 checks'
  var headBranch = null
  var headSha = null
  app.log('env ' + util.inspect(process.env))


  async function check (context) {
    //var listPRs = context.github.pulls.list({
    //  owner: 'Elacarte',
    //  repo: 'ELCPosmon',
    //  state: 'open',
    //  head: 'Elacarte:PINTGR-849'
    //})

    //await listPRs.then(function (PRs) {
    //    app.log('pull request eg: ' + util.inspect(PRs))
    //    app.log('pull request eg: ' + util.inspect(PRs.data[0].user))
    //    app.log('pull request eg: ' + util.inspect(PRs.data[0].head))
    //    app.log('pull request eg: ' + util.inspect(PRs.data[0].base))
    //})
    //app.log('here')
    app.log('case statement ' + context.event + '.' + context.payload.action)
    switch (context.event + '.' + context.payload.action) {
      case 'pull_request.closed':
        app.log('case statement ' + util.inspect(context.payload.pull_request))
        if (!(context.payload.pull_request.number in gdict)) {
          delete gdict[context.payload.pull_request.number]
        }
        break
      case 'pull_request.opened':
        break
      case 'check_suite.requested':
      case 'check_suite.rerequested':
        var users = process.env.POSMON_PYLINT_USERS.split(' ')
        app.log("users " + util.inspect(users) + " " + 
            context.payload.check_suite.head_commit.author.email)
        if (users.indexOf(
          context.payload.check_suite.head_commit.author.email) >= 0) {
            app.log('gdict ' + util.inspect(gdict))
            if (!(context.payload.check_suite.id in gdict)) {
                gdict[context.payload.check_suite.id] = 0
            }
            createCheckRun(context, context.payload.check_suite)
        }
        break
      case 'check_run.created':
        if (context.payload.check_run.check_suite.id in gdict) {
          initCheckRun(context, context.payload.check_run)
          executeCheckRun(context, context.payload.check_run)
        }
        break
      case 'check_suite.completed':
        if (context.payload.check_suite.id in gdict) {
          delete gdict[context.payload.check_suite.id]
        }
        break
      case 'check_run.completed':
        break
      default:
        break
    }
  }

  function finishCheckRun(context, checkSuite, annotations) {
    app.log('finish_check_run ' + util.inspect(annotations))
    if (annotations.length === 0) {
      return context.github.checks.update(context.repo({
        name: APP_CHECK_NAME,
        head_branch: headBranch,
        head_sha: headSha,
        status: 'completed',
        conclusion: 'success',
        completed_at: new Date(),
        output: {
          title: 'Pylint Succeeded ',
          summary: 'The check has passed!'
        },
        check_run_id: context.payload.check_run.id
      }))
    } else {
      return context.github.checks.update(context.repo({
        name: APP_CHECK_NAME,
        head_branch: headBranch,
        head_sha: headSha,
        status: 'completed',
        conclusion: 'failure',
        completed_at: new Date(),
        output: {
          title: 'Pylint Completed ',
          summary: 'please address pylint issues',
          text: 'there are total ' + annotations.length + ' pylint issues',
          annotations: annotations
        },
        actions: [
          {
            label: 'Fix',
            identifier: 'fix_errors',
            description: 'Allow us to fix these errors for you'
          }
        ],
        check_run_id: context.payload.check_run.id
      }))
    }
    return
  }

  function gitLintDiff (localPath) {
    try {
      var curDir = gprocess.cwd()
      gprocess.chdir(localPath)
      var fileJSON = 'git_lint_report.json'
      process.env.PYTHONWARNINGS = 'ignore::yaml.YAMLLoadWarning'
      var commands = 'git-lint --last-commit --json > ' + fileJSON
      app.log('commands ' + commands + ' | ' + localPath)
      cprocess.execSync(commands)
      app.log(path.join(localPath, fileJSON))
      var contents = fs.readFileSync(path.join(localPath, fileJSON))
      gprocess.chdir(curDir)
      return JSON.parse(contents)
    } catch (err) {
      app.log('errors : ' + err)
      app.log(path.join(localPath, fileJSON))
      var contents = fs.readFileSync(path.join(localPath, fileJSON))
      gprocess.chdir(curDir)
      return JSON.parse(contents)
    }
  }

  function executeCheckRun(context, checkSuite) {
    /* run CI test case */
    app.log('execute_check_run')
    var sshPublicKeyPath = process.env.POSMON_PUB_KEY
    var sshPrivateKeyPath = process.env.POSMON_PRIVATE_KEY
    var cloneOptions = {}
    /* RUN pylint check */
    const repoOwner = context.payload.repository.owner.login;
    const repoName = context.payload.repository.name;
    var cloneURL = 'git@github.com:' + repoOwner + '/' + repoName
    var localPath = require('path').join(__dirname,
      'tmp_' + new Date().getTime())
    cloneOptions.checkoutBranch = headBranch
    cloneOptions.fetchOpts = {
      callbacks: {
        certificateCheck: () => 0,
        credentials: function (url, userName) {
          app.log('credentials ' + url + ' ' + userName)
          return Git.Cred.sshKeyNew(userName, sshPublicKeyPath,
            sshPrivateKeyPath, '')
        }
      }
    }
    

    var issueNumber = null
    if (context.payload.check_run.check_suite.pull_requests.length === 0) {
        var listPRs = context.github.pulls.list({
          owner: repoOwner,
          repo: repoName,
          state: 'open',
          head: repoOwner+':'+headBranch
        })

        listPRs.then(function (PRs) {
            app.log('pull request eg: ' + util.inspect(PRs))
            issueNumber = PRs.data[0].number
        })
    } else {
        issueNumber = context.payload.check_run.
          check_suite.pull_requests[0].number
    }
    app.log('middle execute_check_run ' + cloneURL + ' | ' +
      localPath + ' | ' + headBranch + ' | ' +
      context.payload.check_run.check_suite.head_branch + ' | ' +
      issueNumber)
    var cloneRepository = Git.Clone(cloneURL, localPath, cloneOptions)

    var errorAndAttemptOpen = function (err) {
      app.log('error and Attempt Open ' + err)
      return null
    }
    cloneRepository.then(function(repository) {
      app.log('Is the repository bare? %s', Boolean(repository.isBare()))
      /* Pylint CHECK */
      var result = gitLintDiff(localPath)
      app.log(JSON.stringify(result, null, '  '))
      const annotations = []
      for (var filePath in result) {
        console.log(filePath + ' | ' + result[filePath])
        if (filePath.endsWith('.py')) {
          var items = result[filePath]
          for (var key in items) {
            var comments = items[key]
            if (key === 'comments' &&
              comments.length + annotations.length < 50) {
              comments.forEach(comment => {
                app.log('key ' + key + ' ' +
                  comment.column + ' ' + comment.line + ' ' +
                  comment.message + ' ' + comment.message_id)
                if (annotations.length < 50) {
                  annotations.push({
                    path: filePath.substr(localPath.length + 1),
                    start_line: comment.line,
                    end_line: comment.line,
                    annotation_level: 'warning',
                    message: '[' + comment.message_id + '] ' + comment.message,
                    start_column: 0,
                    end_column: comment.column
                  })
                }
              })
            }
          }
        }
      }

      finishCheckRun(context, context.payload.check_run, annotations)
      var commentResult = null
      var mkey = [repoOwner, repoName, issueNumber].join('*')
      //if (!(issueNumber in gdict)) {
      //  gdict[issueNumber] = {}
      //}
      var listComments = context.github.issues.listComments({
        owner: repoOwner,
        repo: repoName,
        issue_number: issueNumber
      })

      var foundComment = false
      listComments.then(function (comments) {
        app.log('list comments ' + util.inspect(comments))
        for (let idx = 0; idx < comments.data.length; idx++) {
          app.log('login ' + util.inspect(comments.data[idx]))
          if (comments.data[idx].user.login === 'lint-check[bot]') {
            var commentID = comments.data[idx].id
            commentResult = context.github.issues.updateComment({
              owner: repoOwner,
              repo: repoName,
              comment_id: commentID,
              body: 'There are ' + annotations.length + ' pylint errors to fix'
            })
            foundComment = true
            break
          }
        }
        if (foundComment === false) {
          commentResult = context.github.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: issueNumber,
            body: 'There are ' + annotations.length + ' pylint errors to fix'
          })
        }
        commentResult.then(function (comment) {
          app.log('comment result : ' + util.inspect(comment))
          app.log('path exsit : ' + localPath + ' | ' +
            fs.existsSync(localPath))
          if (fs.existsSync(localPath)) {
            rimraf.sync(localPath)
          }
        })
        app.log('end execute_check_run ' + util.inspect(commentResult))
      })
    }).catch(errorAndAttemptOpen)

    app.log('end execute_check_run')
    return
  }

  function initCheckRun(context, checkSuite) {
    const startTime = new Date()
    // Probot API note: context.repo() =>
    // {username: 'hiimbex', repo: 'testing-things'}
    return context.github.checks.update(context.repo({
      name: APP_CHECK_NAME,
      head_branch: headBranch,
      head_sha: headSha,
      status: 'in_progress',
      started_at: startTime,
      check_run_id: context.payload.check_run.id
    }))
  }

  function createCheckRun(context, checkSuite) {
    headBranch = context.payload.check_suite.head_branch
    headSha = context.payload.check_suite.head_sha
    app.log('createCheckRUn ' + headBranch + ' | ' + headSha)
    // Probot API note: context.repo() =>
    // {username: 'hiimbex', repo: 'testing-things'}
    return context.github.checks.create(context.repo({
      name: APP_CHECK_NAME,
      head_branch: headBranch,
      head_sha: headSha
    }))
  }
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
}
