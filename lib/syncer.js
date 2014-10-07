(function syncer() {

  var JiraApi = require('jira').JiraApi;
  var GithubApi = require('github');
  var _ = require('underscore');
  var async = require('async');
  var jiraExtension = require('./jira-extension.js');
  var context = {};
    context.ghIssues = [];
    context.ghClosedIssues = [];
  var request = require('request');

  var configApis = function configApis(config) {
    var apis = { jira: {} };
    apis.jira.default = new JiraApi(
      config.jira.protocol,
      config.jira.host,
      config.jira.port,
      config.jira.user,
      config.jira.password,
      config.jira.defaultApi.version
    );
    apis.jira.greenhopper = new JiraApi(
      config.jira.protocol,
      config.jira.host,
      config.jira.port,
      config.jira.user,
      config.jira.password,
      config.jira.greenhopper.version
    );
    jiraExtension.extend(apis.jira.greenhopper);

    apis.github = new GithubApi({version: "3.0.0"});
    apis.github.authenticate(config.github.auth);
    return apis;
  };

  var errorLog = function(error) {
    if(error) {
      console.log(error);
    }
  };

  var getCurrentSprint = function getCurrentSprint(callback) {
    context.api.jira.greenhopper.findRapidView(context.config.jira.project, function(error, rapidView) {
      context.rapidView = rapidView;
      context.api.jira.greenhopper.getLastSprintForRapidView(rapidView.id, function(error, sprint) {
        context.sprint = sprint;
        callback(sprint);
      });
    });
  };

  var checkIfMilestoneExists = function checkIfMilestoneExists(sprint, repo, callback) {
    var msg = _.extend({
        state:'open',
        repo: repo
    }, context.config.github);
    context.api.github.issues.getAllMilestones(msg, function(error, milestones) {
      var milestone = _.find(milestones, function(milestone) { return milestone.title == sprint.name;});
      if( milestone ) {
        context.milestone = milestone;
        console.log(' - Exists in repo ' + repo);
        callback(error, true);
      } else {
        console.log(' - Not found in repo ' + repo);
        callback(error, false);
      }
    });
  };

  var createMilestone = function createMilestone(sprint, repo, callback) {
    var createMilestoneMsg = _.extend({
        title: sprint.name,
        state:'open',
        repo: repo
    }, context.config.github);
    context.api.github.issues.createMilestone(createMilestoneMsg, function(error, result) {
      console.log(' - New milestone created');
      context.milestone = result;
      callback(null);
    });
  };

  var buildMilestone = function buildMilestone(callback) {
    getCurrentSprint(function operateSprint(sprint) {
      console.log('Sprint: ' + sprint.name);
        _.each(context.config.github.repos, function(repo){
          checkIfMilestoneExists(sprint, repo, function milestoneProbe(error, exists) {
            if(exists) {
                // update?
                callback(null);
            } else {
                createMilestone(sprint, repo, callback);
            }
          });
        });
    });
  };

  var getAllSprintIssues = function getAllSprintIssues(callback){
      _.each(context.config.github.repos, function(repo){
          getSprintIssues(repo, callback);
      });
  };

  var getSprintIssues = function getSprintIssues(repo, callback) {
      var filter = _.extend({
          //milestone: context.milestone.number,
          sort: 'updated',
          direction: 'desc',
          repo: repo,
          per_page: 100
      }, context.config.github);
      // Need to check all repos for issue list to not duplicate
      context.api.github.issues.repoIssues(filter, function saveGhIssues(error, issues) {
          context.ghIssues = _.union(context.ghIssues, issues);
          console.log('Got ' + issues.length + ' issues open from milestone on GH in repo ' + repo );
          callback(error, issues);
      });
  };

  var getAllClosedSprintIssues = function getAllClosedSprintIssues(callback){
      _.each(context.config.github.repos, function(repo){
          getClosedSprintIssues(repo, callback);
      });
  };

  var getClosedSprintIssues = function getClosedSprintIssues(repo, callback) {
    var filter = _.extend({
     //milestone: context.milestone.number,
     state: 'closed',
     sort: 'updated',
     direction: 'desc',
     per_page: 100,
     repo: repo
    }, context.config.github);
    context.api.github.issues.repoIssues(filter, function saveGhIssues(error, issues) {
      context.ghClosedIssues = _.union(context.ghClosedIssues, issues);
      context.ghIssues = _.union(issues, (context.ghIssues) ? context.ghIssues : null);
      console.log('Got ' + issues.length + ' issues closed from milestone on GH from repo ' + repo );
      callback(error, issues);
    });
  };

  var getGhIssueFor = function getGhIssue(jiraIssue) {
    var match =  _.find(context.ghIssues, function(current) {
      return current.title.match("^" + jiraIssue.key);
    });
    return match;
  };

  var getGhUserFor = function getGhUserFor(jiraUser) {
    var ghuser = context.config.userMapping[jiraUser];
    if(!ghuser) {
      throw new Error("Can't find ghuser for jiraUser:" + jiraUser);
    }
    return ghuser;
  };

  var createGhIssue = function createGhIssue(jiraIssue, callback) {
    context.api.jira.default.findIssue(jiraIssue.key, function getIssue(error, completeIssue) {

        _.each(completeIssue.fields.components, function(component){
            var repo = component.name.toLowerCase();
            console.log('\t-Created new in repo: ' + repo);
            var args = _.extend({
                assignee: getGhUserFor(jiraIssue.assignee),
                title: (jiraIssue.key + ': ' + jiraIssue.summary).toString('utf8'),
                milestone: context.milestone.number,
                labels: [jiraIssue.typeName, jiraIssue.priorityName]
            });
            var requestArgs = {
                uri: 'https://api.github.com/repos/'+context.config.github.user+'/'+repo+'/issues',
                body: JSON.stringify(args),
                headers: {
                    authorization: 'Basic ' + new Buffer(context.config.github.auth.username + ":" + context.config.github.auth.password, "ascii").toString("base64"),
                    'content-type': 'application/json',
                    'user-agent': 'request'
                }
            };
            request.post(requestArgs, function afterRequest(e, r, body) {
                callback(e, body);
            });
        });
    });
  };

  var jiraTypes = [
    'Task', 'Bug', 'Sub-task', 'User Story',
    'Technical-Task', 'Design-Task',
    'Technical Task', 'Design Task'
  ];

  var validIssueTypeForImport = function validIssueTypeForImport(typeName) {
    var match = _.find(jiraTypes, function finder(jiraType) {return jiraType === typeName; });
    return match !== undefined;
  };

  var generateGithubIssue = function generateGithubIssue(issues, callback, masterCallback) {
    var issue = issues.pop();
    console.log(' - ' + issue.typeName + ':' + issue.key );

    if(validIssueTypeForImport(issue.typeName)) {
      var ghissue = getGhIssueFor(issue);
      if(ghissue) {
        console.log('\t- Already exists');
        generateGithubIssues(issues, null, masterCallback);
      } else {
        createGhIssue(issue, function(error, ghIssueBody) {
          linkGhSubtasks(issue, ghIssueBody, function () {
            generateGithubIssues(issues, null, masterCallback);
          });
        });
      }
    } else {
      console.log('\t- Ignored');
      generateGithubIssues(issues, null, masterCallback);
    }
  };

  var generateGithubIssues = function generateGithubIssues(issues, callback, masterCallback) {
    if(_.isEmpty(issues) ) {
      masterCallback(null);
    } else {
      generateGithubIssue(issues, generateGithubIssues, masterCallback);
    }
  };

  var addJiraSubtasks = function addJiraSubtasks(issue, callback) {
    context.api.jira.default.findIssue(issue.key, function getIssue(error, completeIssue) {
      if(!completeIssue){
          callback(error);
          return;
      }
      _.each(completeIssue.fields.subtasks, function(subtask) {
        subtask.typeName = subtask.fields.issuetype.name;
        subtask.summary = subtask.fields.summary;
        subtask.priorityName = subtask.fields.priority.name;
        subtask.assignee = issue.assignee;
        subtask.__parentId = issue.key;
      });
      context.subIssues = _.union(context.subIssues, completeIssue.fields.subtasks);
      callback(error, completeIssue);
    });
  };

  var createJiraTasksOnGithub = function createJiraTasksOnGithub(callback) {
    context.api.jira.greenhopper.getSprintIssues(context.rapidView.id, context.sprint.id, function(error, result) {
      errorLog(error);
      var masterIssues = _.union(result.contents.completedIssues, result.contents.incompletedIssues);
      context.subIssues = [];

      async.each(masterIssues, addJiraSubtasks, function completed(err) {
        context.jiraOpenIssues = _.union(result.contents.incompletedIssues, context.subIssues);
        var issues = _.union(result.contents.incompletedIssues, context.subIssues); // clone
        console.log('Sprint issues: ' + context.jiraOpenIssues.length);
        generateGithubIssues(issues, null, callback);
      });
    });
  };

  // Get a github parent id by it's jira key
  var getGhParentId = function getGhParentId(key, callback){
    var args = _.extend({
      q: key
    });
    context.api.github.search.issues(args, function(error, body){
      callback(error, body.items[0].number);
    })
  };

  // Adds comments to each subtask relating back to the parent task
  var linkGhSubtasks = function linkGhSubtasks(subtask, ghIssueBody, callback){
    if(!subtask.__parentId){
      return callback(null);
    }
    getGhParentId(subtask.__parentId, function(error, parentId){
      var args = {
        body: "Related to #" + parentId + " (" + subtask.__parentId + ") as sub-task"
      };

      var requestArgs = {
        uri: JSON.parse(ghIssueBody).comments_url,
        body: JSON.stringify(args),
        headers: {
          authorization: 'Basic ' + new Buffer(context.config.github.auth.username + ":" + context.config.github.auth.password, "ascii").toString("base64"),
          'content-type': 'application/json',
          'user-agent': 'request'
        }
      };

      request.post(requestArgs, function afterRequest(e, r, body){
        callback(e);
      });
    });
  };

  var getJiraIssueFor = function getJiraIssue(ghIssue) {
    return _.find(context.jiraOpenIssues, function iter(jiraIssue) {
      return ghIssue.title.match('^' + jiraIssue.key + ':');
    });
  };

  var closeJiraTask = function closeJiraTask(ghIssue, callback) {
      var jiraIssue = getJiraIssueFor(ghIssue);
      if (!jiraIssue) {
          // already closed
          return;
      }
      context.api.jira.default.listTransitions(jiraIssue.key, function (error, body) {
          //Check if "close issue" is a type
          if (error) {
              callback(error);
          }
          _.each(body, function (transitionType) {
              if (transitionType.id === '5') {
                  var msg = {
                      "transition" : transitionType
                  };
                  context.api.jira.default.transitionIssue(jiraIssue.key, msg, function (error) {
                      console.log(' - ' + ghIssue.number + ' -> ' + ghIssue.title);
                      if (error) {
                          console.log('\t * ' + error);
                      } else {
                          console.log('\t - Resolved');
                      }
                      //callback(null);
                  });
              }
          });
      });
  };

  var closeJiraTasks = function closeJiraTasks(callback) {
    _.each(context.ghClosedIssues, closeJiraTask, callback);
  };

  exports.process = function process(config) {
    context.config = config;
    context.api = configApis(config);
    async.series([
      buildMilestone,
      getAllSprintIssues,
      getAllClosedSprintIssues,
      createJiraTasksOnGithub,
      closeJiraTasks
    ], errorLog);
  };

})();
